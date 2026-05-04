import type { Workstream, WorkstreamEvent } from "@crew/core";

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
