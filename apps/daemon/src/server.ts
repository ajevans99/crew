import Fastify from "fastify";
import {
  createWorkstream,
  getEvents,
  runHelloCommand,
  WorkstreamNotFoundError,
  type WorkstreamEvent
} from "@crew/core";

type WorkstreamParams = {
  id: string;
};

const fastify = Fastify({ logger: true });
const runningWorkstreams = new Set<string>();
const subscribers = new Map<string, Set<(event: WorkstreamEvent) => void>>();

fastify.post("/api/workstreams", async () => {
  const workstream = createWorkstream();
  return { id: workstream.id };
});

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

const port = Number(process.env.PORT ?? 8787);
await fastify.listen({ port, host: "0.0.0.0" });
