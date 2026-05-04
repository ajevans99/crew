import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import type { Readable } from "node:stream";
import Fastify from "fastify";
import {
  appendEvent,
  createWorkstream,
  getEvents,
  getWorkstream,
  listWorkstreams,
  runHelloCommand,
  WorkstreamNotFoundError,
  type ServiceDefinition,
  type WorkstreamEvent
} from "@crew/core";

type WorkstreamParams = {
  id: string;
};

type ServiceParams = WorkstreamParams & {
  name: string;
};

type ServiceStatus = "stopped" | "starting" | "ready" | "failed";

type ManagedService = {
  definition: ServiceDefinition;
  workstreamId: string;
  port: number;
  process?: ChildProcess;
  status: ServiceStatus;
  healthy: boolean;
  stopping: boolean;
  healthTimer?: NodeJS.Timeout;
};

const fastify = Fastify({ logger: true });
const runningWorkstreams = new Set<string>();
const subscribers = new Map<string, Set<(event: WorkstreamEvent) => void>>();
const services = new Map<string, ManagedService>();
const repoRoot =
  process.env.CREW_REPO_ROOT ??
  resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const serviceDefinitions: ServiceDefinition[] = [
  {
    name: "web",
    command: "pnpm dev --host 0.0.0.0",
    cwd: "apps/web",
    portEnvName: "PORT",
    healthUrl: "http://localhost:{port}/"
  }
];

fastify.get("/api/workstreams", async () => {
  return { workstreams: listWorkstreams() };
});

fastify.post("/api/workstreams", async () => {
  const workstream = createWorkstream();
  return { id: workstream.id };
});

fastify.get<{ Params: WorkstreamParams }>(
  "/api/workstreams/:id",
  async (request, reply) => {
    try {
      return { workstream: getWorkstream(request.params.id) };
    } catch (error) {
      if (error instanceof WorkstreamNotFoundError) {
        return reply.code(404).send({ error: "Workstream not found" });
      }

      request.log.error(error);
      return reply.code(500).send({ error: "Failed to load workstream" });
    }
  }
);

fastify.post<{ Params: WorkstreamParams }>(
  "/api/workstreams/:id/run",
  async (request, reply) => {
    const { id } = request.params;

    if (runningWorkstreams.has(id)) {
      return reply.code(409).send({ error: "Workstream is already running" });
    }

    try {
      runningWorkstreams.add(id);
      await runHelloCommand(id, undefined, (event) => publishEvent(id, event));
      return { ok: true };
    } catch (error) {
      if (error instanceof WorkstreamNotFoundError) {
        return reply.code(404).send({ error: "Workstream not found" });
      }

      request.log.error(error);
      return reply.code(500).send({ error: "Failed to run command" });
    } finally {
      runningWorkstreams.delete(id);
    }
  }
);

fastify.get<{ Params: WorkstreamParams }>(
  "/api/workstreams/:id/services",
  async (request, reply) => {
    try {
      return {
        services: await Promise.all(
          serviceDefinitions.map((definition) =>
            getServiceView(request.params.id, definition.name)
          )
        )
      };
    } catch (error) {
      if (error instanceof WorkstreamNotFoundError) {
        return reply.code(404).send({ error: "Workstream not found" });
      }

      request.log.error(error);
      return reply.code(500).send({ error: "Failed to load services" });
    }
  }
);

fastify.post<{ Params: ServiceParams }>(
  "/api/workstreams/:id/services/:name/start",
  async (request, reply) => {
    try {
      const service = startService(request.params.id, request.params.name);
      return { service: await serializeService(service) };
    } catch (error) {
      if (error instanceof WorkstreamNotFoundError) {
        return reply.code(404).send({ error: "Workstream not found" });
      }

      if (error instanceof ServiceNotFoundError) {
        return reply.code(404).send({ error: "Service not found" });
      }

      request.log.error(error);
      return reply.code(500).send({ error: "Failed to start service" });
    }
  }
);

fastify.post<{ Params: ServiceParams }>(
  "/api/workstreams/:id/services/:name/stop",
  async (request, reply) => {
    try {
      const service = stopService(request.params.id, request.params.name);
      return { service: await serializeService(service) };
    } catch (error) {
      if (error instanceof WorkstreamNotFoundError) {
        return reply.code(404).send({ error: "Workstream not found" });
      }

      if (error instanceof ServiceNotFoundError) {
        return reply.code(404).send({ error: "Service not found" });
      }

      request.log.error(error);
      return reply.code(500).send({ error: "Failed to stop service" });
    }
  }
);

fastify.get<{ Params: WorkstreamParams }>(
  "/api/workstreams/:id/events",
  async (request, reply) => {
    try {
      return { events: getEvents(request.params.id) };
    } catch (error) {
      if (error instanceof WorkstreamNotFoundError) {
        return reply.code(404).send({ error: "Workstream not found" });
      }

      request.log.error(error);
      return reply.code(500).send({ error: "Failed to load events" });
    }
  }
);

fastify.get<{ Params: WorkstreamParams }>(
  "/api/workstreams/:id/events/stream",
  async (request, reply) => {
    const { id } = request.params;

    try {
      const existingEvents = getEvents(id);

      reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive"
      });

      const send = (event: WorkstreamEvent) => {
        reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
      };

      for (const event of existingEvents) {
        send(event);
      }

      addSubscriber(id, send);
      request.raw.on("close", () => removeSubscriber(id, send));
      reply.hijack();
    } catch (error) {
      if (error instanceof WorkstreamNotFoundError) {
        return reply.code(404).send({ error: "Workstream not found" });
      }

      request.log.error(error);
      return reply.code(500).send({ error: "Failed to open event stream" });
    }
  }
);

function publishEvent(workstreamId: string, event: WorkstreamEvent) {
  const workstreamSubscribers = subscribers.get(workstreamId);
  if (!workstreamSubscribers) {
    return;
  }

  for (const send of workstreamSubscribers) {
    send(event);
  }
}

function addSubscriber(
  workstreamId: string,
  send: (event: WorkstreamEvent) => void
) {
  const workstreamSubscribers = subscribers.get(workstreamId) ?? new Set();
  workstreamSubscribers.add(send);
  subscribers.set(workstreamId, workstreamSubscribers);
}

function removeSubscriber(
  workstreamId: string,
  send: (event: WorkstreamEvent) => void
) {
  const workstreamSubscribers = subscribers.get(workstreamId);
  if (!workstreamSubscribers) {
    return;
  }

  workstreamSubscribers.delete(send);
  if (workstreamSubscribers.size === 0) {
    subscribers.delete(workstreamId);
  }
}

class ServiceNotFoundError extends Error {
  constructor(name: string) {
    super(`Service not found: ${name}`);
    this.name = "ServiceNotFoundError";
  }
}

async function getServiceView(workstreamId: string, name: string) {
  return serializeService(getManagedService(workstreamId, name));
}

function getManagedService(workstreamId: string, name: string) {
  const workstream = getWorkstream(workstreamId);
  const definitionIndex = serviceDefinitions.findIndex(
    (definition) => definition.name === name
  );

  if (definitionIndex === -1) {
    throw new ServiceNotFoundError(name);
  }

  const key = serviceKey(workstreamId, name);
  const existing = services.get(key);
  if (existing) {
    return existing;
  }

  const service: ManagedService = {
    definition: serviceDefinitions[definitionIndex],
    workstreamId,
    port: workstream.portBase + definitionIndex,
    status: "stopped",
    healthy: false,
    stopping: false
  };

  services.set(key, service);
  return service;
}

function startService(workstreamId: string, name: string) {
  const service = getManagedService(workstreamId, name);

  if (service.process) {
    return service;
  }

  service.status = "starting";
  service.healthy = false;
  service.stopping = false;

  logServiceEvent(
    service,
    `starting ${service.definition.command} on port ${service.port}`
  );

  const [command, ...args] = service.definition.command.split(" ");
  const child = spawn(command, args, {
    cwd: resolve(repoRoot, service.definition.cwd),
    env: {
      ...process.env,
      [service.definition.portEnvName]: String(service.port)
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  service.process = child;
  if (child.stdout) {
    streamServiceOutput(service, child.stdout);
  }
  if (child.stderr) {
    streamServiceOutput(service, child.stderr);
  }

  child.once("error", (error) => {
    service.status = "failed";
    service.healthy = false;
    clearHealthTimer(service);
    logServiceEvent(service, `failed to start: ${error.message}`);
  });

  child.once("exit", (code, signal) => {
    service.process = undefined;
    service.healthy = false;
    clearHealthTimer(service);

    if (service.stopping || code === 0) {
      service.status = "stopped";
    } else {
      service.status = "failed";
    }

    service.stopping = false;
    logServiceEvent(
      service,
      `exited with code ${code ?? "null"} and signal ${signal ?? "null"}`
    );
  });

  startHealthTimer(service);
  return service;
}

function stopService(workstreamId: string, name: string) {
  const service = getManagedService(workstreamId, name);

  service.stopping = true;
  service.status = "stopped";
  service.healthy = false;
  clearHealthTimer(service);

  if (service.process) {
    logServiceEvent(service, "stopping");
    service.process.kill("SIGTERM");

    const child = service.process;
    setTimeout(() => {
      if (!child.killed) {
        child.kill("SIGKILL");
      }
    }, 3000);
  }

  return service;
}

async function serializeService(service: ManagedService) {
  await refreshServiceHealth(service);

  return {
    name: service.definition.name,
    command: service.definition.command,
    cwd: service.definition.cwd,
    portEnvName: service.definition.portEnvName,
    port: service.port,
    healthUrl: resolveHealthUrl(service),
    localUrl: `http://localhost:${service.port}`,
    status: service.status,
    healthy: service.healthy
  };
}

function streamServiceOutput(
  service: ManagedService,
  stream: Readable
) {
  stream.setEncoding("utf8");

  let buffer = "";
  stream.on("data", (chunk: string) => {
    buffer += chunk;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (line.length > 0) {
        logServiceEvent(service, line);
      }
    }
  });

  stream.once("end", () => {
    if (buffer.length > 0) {
      logServiceEvent(service, buffer);
    }
  });
}

function startHealthTimer(service: ManagedService) {
  clearHealthTimer(service);
  void refreshServiceHealth(service);
  service.healthTimer = setInterval(() => {
    void refreshServiceHealth(service);
  }, 1000);
}

function clearHealthTimer(service: ManagedService) {
  if (service.healthTimer) {
    clearInterval(service.healthTimer);
    service.healthTimer = undefined;
  }
}

async function refreshServiceHealth(service: ManagedService) {
  if (!service.process || service.status === "stopped" || service.status === "failed") {
    service.healthy = false;
    return;
  }

  const healthy = await checkHealth(resolveHealthUrl(service));
  const wasHealthy = service.healthy;
  service.healthy = healthy;

  if (healthy && service.status === "starting") {
    service.status = "ready";
    logServiceEvent(service, `ready at http://localhost:${service.port}`);
  }

  if (!healthy && wasHealthy) {
    logServiceEvent(service, `health check failed at ${resolveHealthUrl(service)}`);
  }
}

async function checkHealth(url: string) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(1000) });
    return response.ok;
  } catch {
    return false;
  }
}

function logServiceEvent(service: ManagedService, message: string) {
  const event = appendEvent(
    service.workstreamId,
    `[${service.definition.name}] ${message}`
  );
  publishEvent(service.workstreamId, event);
}

function resolveHealthUrl(service: ManagedService) {
  return service.definition.healthUrl.replace("{port}", String(service.port));
}

function serviceKey(workstreamId: string, name: string) {
  return `${workstreamId}:${name}`;
}

const port = Number(process.env.PORT ?? 8787);
await fastify.listen({ port, host: "0.0.0.0" });
