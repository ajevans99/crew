import type {
  AgentRun,
  Workstream,
  WorkstreamEvent
} from "@crew/core";
import type { ChannelAdapter, RuntimeAdapter } from "@crew/sdk";

export type ServiceStatus = "stopped" | "starting" | "ready" | "failed";

export type WorkstreamService = {
  name: string;
  command: string;
  cwd: string;
  portEnvName: string;
  port: number;
  healthUrl: string;
  localUrl: string;
  status: ServiceStatus;
  healthy: boolean;
};

export type AdapterView = Pick<ChannelAdapter | RuntimeAdapter, "id" | "displayName">;

export async function listAdapters() {
  const response = await fetch("/api/adapters");
  if (!response.ok) {
    throw new Error("Failed to load adapters");
  }

  return (await response.json()) as {
    channelAdapters: AdapterView[];
    runtimeAdapters: AdapterView[];
  };
}

export async function listWorkstreams() {
  const response = await fetch("/api/workstreams");
  if (!response.ok) {
    throw new Error("Failed to load workstreams");
  }

  const data = (await response.json()) as { workstreams: Workstream[] };
  return data.workstreams;
}

export async function getWorkstream(workstreamId: string) {
  const response = await fetch(`/api/workstreams/${workstreamId}`);
  if (!response.ok) {
    throw new Error("Failed to load workstream");
  }

  const data = (await response.json()) as { workstream: Workstream };
  return data.workstream;
}

export async function createWorkstream() {
  const response = await fetch("/api/workstreams", { method: "POST" });
  if (!response.ok) {
    throw new Error("Failed to create workstream");
  }

  return (await response.json()) as { id: string };
}

export async function runCommand(workstreamId: string) {
  const response = await fetch(`/api/workstreams/${workstreamId}/run`, {
    method: "POST"
  });
  if (!response.ok) {
    throw new Error("Failed to run command");
  }

  return (await response.json()) as { ok: true };
}

export async function getEvents(workstreamId: string) {
  const response = await fetch(`/api/workstreams/${workstreamId}/events`);
  if (!response.ok) {
    throw new Error("Failed to load events");
  }

  const data = (await response.json()) as { events: WorkstreamEvent[] };
  return data.events;
}

export async function listServices(workstreamId: string) {
  const response = await fetch(`/api/workstreams/${workstreamId}/services`);
  if (!response.ok) {
    throw new Error("Failed to load services");
  }

  const data = (await response.json()) as { services: WorkstreamService[] };
  return data.services;
}

export async function startService({
  workstreamId,
  name
}: {
  workstreamId: string;
  name: string;
}) {
  const response = await fetch(
    `/api/workstreams/${workstreamId}/services/${name}/start`,
    { method: "POST" }
  );
  if (!response.ok) {
    throw new Error("Failed to start service");
  }

  const data = (await response.json()) as { service: WorkstreamService };
  return data.service;
}

export async function stopService({
  workstreamId,
  name
}: {
  workstreamId: string;
  name: string;
}) {
  const response = await fetch(
    `/api/workstreams/${workstreamId}/services/${name}/stop`,
    { method: "POST" }
  );
  if (!response.ok) {
    throw new Error("Failed to stop service");
  }

  const data = (await response.json()) as { service: WorkstreamService };
  return data.service;
}

export async function listAgentRuns(workstreamId: string) {
  const response = await fetch(`/api/workstreams/${workstreamId}/agent-runs`);
  if (!response.ok) {
    throw new Error("Failed to load agent runs");
  }

  const data = (await response.json()) as { agentRuns: AgentRun[] };
  return data.agentRuns;
}

export async function createAgentRun(workstreamId: string) {
  const response = await fetch(`/api/workstreams/${workstreamId}/agent-runs`, {
    method: "POST"
  });
  if (!response.ok) {
    throw new Error("Failed to start agent run");
  }

  const data = (await response.json()) as { agentRun: AgentRun };
  return data.agentRun;
}

export async function createRun({
  workstreamId,
  runtimeAdapterId,
  prompt
}: {
  workstreamId: string;
  runtimeAdapterId: string;
  prompt: string;
}) {
  const response = await fetch(`/api/workstreams/${workstreamId}/runs`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ runtimeAdapterId, prompt })
  });
  if (!response.ok) {
    throw new Error("Failed to start run");
  }

  return (await response.json()) as { runId: string };
}
