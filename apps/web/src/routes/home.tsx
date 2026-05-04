import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AgentRun,
  WorkstreamEvent,
  WorkstreamEventActorType,
  WorkstreamEventType,
  WorkstreamStatus
} from "@crew/core";
import type { RuntimeAdapter } from "@crew/sdk";
import {
  createRun,
  createWorkstream,
  getEvents,
  getWorkstream,
  listAgentRuns,
  listAdapters,
  listServices,
  listWorkstreams,
  runCommand,
  startService,
  stopService,
  type ServiceStatus,
  type WorkstreamService
} from "@/api";
import { useCrewStore } from "@/store";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function HomePage() {
  const queryClient = useQueryClient();
  const [actorFilter, setActorFilter] = useState<"all" | WorkstreamEventActorType>(
    "all"
  );
  const [typeFilter, setTypeFilter] = useState<"all" | WorkstreamEventType>(
    "all"
  );
  const [autoScroll, setAutoScroll] = useState(true);
  const [runtimeAdapterId, setRuntimeAdapterId] = useState("shell");
  const [runPrompt, setRunPrompt] = useState("echo hello");
  const timelineEndRef = useRef<HTMLDivElement | null>(null);
  const {
    selectedWorkstreamId,
    sidebarCollapsed,
    setSelectedWorkstreamId,
    toggleSidebar
  } = useCrewStore();

  const workstreamsQuery = useQuery({
    queryKey: ["workstreams"],
    queryFn: listWorkstreams
  });

  const adaptersQuery = useQuery({
    queryKey: ["adapters"],
    queryFn: listAdapters
  });

  const workstreams = workstreamsQuery.data ?? [];
  const selectedExists = selectedWorkstreamId
    ? workstreams.some((workstream) => workstream.id === selectedWorkstreamId)
    : false;

  const selectedWorkstreamQuery = useQuery({
    queryKey: ["workstream", selectedWorkstreamId],
    queryFn: () => getWorkstream(selectedWorkstreamId!),
    enabled: selectedExists,
    refetchInterval: 1000
  });

  const eventsQuery = useQuery({
    queryKey: ["events", selectedWorkstreamId],
    queryFn: () => getEvents(selectedWorkstreamId!),
    enabled: selectedExists,
    refetchInterval: 1000
  });

  const servicesQuery = useQuery({
    queryKey: ["services", selectedWorkstreamId],
    queryFn: () => listServices(selectedWorkstreamId!),
    enabled: selectedExists,
    refetchInterval: 1000
  });

  const agentRunsQuery = useQuery({
    queryKey: ["agent-runs", selectedWorkstreamId],
    queryFn: () => listAgentRuns(selectedWorkstreamId!),
    enabled: selectedExists,
    refetchInterval: 1000
  });

  useEffect(() => {
    if (!workstreamsQuery.isSuccess) {
      return;
    }

    if (selectedWorkstreamId && !selectedExists) {
      setSelectedWorkstreamId(workstreams[0]?.id ?? null);
      return;
    }

    if (!selectedWorkstreamId && workstreams.length > 0) {
      setSelectedWorkstreamId(workstreams[0].id);
    }
  }, [
    selectedExists,
    selectedWorkstreamId,
    setSelectedWorkstreamId,
    workstreams,
    workstreamsQuery.isSuccess
  ]);

  const createWorkstreamMutation = useMutation({
    mutationFn: createWorkstream,
    onSuccess: ({ id }) => {
      setSelectedWorkstreamId(id);
      queryClient.invalidateQueries({ queryKey: ["workstreams"] });
      queryClient.invalidateQueries({ queryKey: ["workstream", id] });
      queryClient.setQueryData(["events", id], []);
    }
  });

  const runCommandMutation = useMutation({
    mutationFn: runCommand,
    onSuccess: () => {
      if (selectedWorkstreamId) {
        queryClient.invalidateQueries({ queryKey: ["workstreams"] });
        queryClient.invalidateQueries({
          queryKey: ["workstream", selectedWorkstreamId]
        });
        queryClient.invalidateQueries({
          queryKey: ["events", selectedWorkstreamId]
        });
      }
    }
  });

  const startServiceMutation = useMutation({
    mutationFn: startService,
    onSuccess: () => {
      if (selectedWorkstreamId) {
        queryClient.invalidateQueries({
          queryKey: ["services", selectedWorkstreamId]
        });
        queryClient.invalidateQueries({
          queryKey: ["events", selectedWorkstreamId]
        });
      }
    }
  });

  const stopServiceMutation = useMutation({
    mutationFn: stopService,
    onSuccess: () => {
      if (selectedWorkstreamId) {
        queryClient.invalidateQueries({
          queryKey: ["services", selectedWorkstreamId]
        });
        queryClient.invalidateQueries({
          queryKey: ["events", selectedWorkstreamId]
        });
      }
    }
  });

  const createRunMutation = useMutation({
    mutationFn: createRun,
    onSuccess: () => {
      if (selectedWorkstreamId) {
        queryClient.invalidateQueries({
          queryKey: ["agent-runs", selectedWorkstreamId]
        });
        queryClient.invalidateQueries({
          queryKey: ["events", selectedWorkstreamId]
        });
      }
    }
  });

  const selectedWorkstream = selectedWorkstreamQuery.data;
  const events = eventsQuery.data ?? [];
  const services = servicesQuery.data ?? [];
  const agentRuns = agentRunsQuery.data ?? [];
  const activeAgentRun =
    agentRuns.find(
      (agentRun) =>
        agentRun.status === "queued" || agentRun.status === "running"
    ) ?? agentRuns[0];
  const agentEvents = events.filter((event) => event.type.startsWith("agent."));
  const actorOptions = useMemo(
    () => Array.from(new Set(events.map((event) => event.actorType))).sort(),
    [events]
  );
  const typeOptions = useMemo(
    () => Array.from(new Set(events.map((event) => event.type))).sort(),
    [events]
  );
  const filteredEvents = useMemo(
    () =>
      events.filter(
        (event) =>
          (actorFilter === "all" || event.actorType === actorFilter) &&
          (typeFilter === "all" || event.type === typeFilter)
      ),
    [actorFilter, events, typeFilter]
  );
  const eventGroups = useMemo(
    () => groupTimelineEvents(filteredEvents),
    [filteredEvents]
  );

  useEffect(() => {
    if (autoScroll) {
      timelineEndRef.current?.scrollIntoView({ block: "end" });
    }
  }, [autoScroll, filteredEvents.length]);
  const error =
    createWorkstreamMutation.error ??
    runCommandMutation.error ??
    startServiceMutation.error ??
    stopServiceMutation.error ??
    createRunMutation.error ??
    adaptersQuery.error ??
    workstreamsQuery.error ??
    selectedWorkstreamQuery.error ??
    servicesQuery.error ??
    agentRunsQuery.error ??
    eventsQuery.error;

  const canRun =
    Boolean(selectedWorkstreamId) &&
    selectedWorkstream?.status !== "running" &&
    !runCommandMutation.isPending;

  return (
    <main className="flex min-h-screen bg-slate-50 text-slate-950">
      <aside
        className={`border-r bg-white transition-all ${
          sidebarCollapsed ? "w-16" : "w-80"
        }`}
      >
        <div className="flex items-center justify-between border-b p-4">
          {!sidebarCollapsed ? (
            <h1 className="text-lg font-semibold">Crew</h1>
          ) : null}
          <Button variant="outline" onClick={toggleSidebar}>
            {sidebarCollapsed ? ">" : "<"}
          </Button>
        </div>

        {!sidebarCollapsed ? (
          <div className="space-y-4 p-4">
            <Button
              className="w-full"
              onClick={() => createWorkstreamMutation.mutate()}
              disabled={createWorkstreamMutation.isPending}
            >
              {createWorkstreamMutation.isPending
                ? "Creating..."
                : "Create Workstream"}
            </Button>

            {workstreams.length > 0 ? (
              <div className="space-y-2">
                {workstreams.map((workstream) => (
                  <button
                    key={workstream.id}
                    className={`w-full rounded-lg border p-3 text-left transition-colors ${
                      workstream.id === selectedWorkstreamId
                        ? "border-slate-900 bg-slate-100"
                        : "border-slate-200 hover:bg-slate-50"
                    }`}
                    onClick={() => setSelectedWorkstreamId(workstream.id)}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate font-mono text-xs">
                        {shortId(workstream.id)}
                      </span>
                      <StatusBadge status={workstream.status} />
                    </div>
                    <p className="mt-2 text-xs text-slate-500">
                      {formatDate(workstream.createdAt)}
                    </p>
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-sm text-slate-500">No workstreams yet.</p>
            )}
          </div>
        ) : null}
      </aside>

      <section className="flex min-w-0 flex-1 flex-col p-6">
        <Card className="flex min-h-0 flex-1 flex-col">
          <CardHeader className="border-b">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0 space-y-2">
                <CardTitle className="text-2xl">Workstream Console</CardTitle>
                {selectedWorkstream ? (
                  <div className="flex flex-wrap items-center gap-3">
                    <p className="truncate font-mono text-sm text-slate-600">
                      {selectedWorkstream.id}
                    </p>
                    <StatusBadge status={selectedWorkstream.status} />
                  </div>
                ) : (
                  <p className="text-sm text-slate-600">
                    Select or create a workstream to begin.
                  </p>
                )}
              </div>

              <Button
                onClick={() =>
                  selectedWorkstreamId && runCommandMutation.mutate(selectedWorkstreamId)
                }
                disabled={!canRun}
              >
                {runCommandMutation.isPending ||
                selectedWorkstream?.status === "running"
                  ? "Running..."
                  : "Run Command"}
              </Button>
            </div>
          </CardHeader>

          <CardContent className="flex min-h-0 flex-1 flex-col gap-4 p-6">
            {error ? (
              <p className="text-sm text-red-600">
                {error instanceof Error ? error.message : "Something went wrong"}
              </p>
            ) : null}

            {selectedWorkstreamId ? (
              <div className="grid gap-4 xl:grid-cols-2">
                {services.map((service) => (
                  <ServiceCard
                    key={service.name}
                    service={service}
                    logs={events
                      .filter((event) =>
                        event.actorType === "service" &&
                        event.actorId === service.name
                      )
                      .slice(-12)}
                    startPending={
                      startServiceMutation.isPending &&
                      startServiceMutation.variables?.name === service.name
                    }
                    stopPending={
                      stopServiceMutation.isPending &&
                      stopServiceMutation.variables?.name === service.name
                    }
                    onStart={() =>
                      startServiceMutation.mutate({
                        workstreamId: selectedWorkstreamId,
                        name: service.name
                      })
                    }
                    onStop={() =>
                      stopServiceMutation.mutate({
                        workstreamId: selectedWorkstreamId,
                        name: service.name
                      })
                    }
                  />
                ))}
                {activeAgentRun ? (
                  <AgentRunCard agentRun={activeAgentRun} events={agentEvents} />
                ) : (
                  <div className="rounded-xl border bg-white p-4 shadow-sm">
                    <h2 className="font-semibold">Agent run</h2>
                    <p className="mt-2 text-sm text-slate-500">
                      Run a shell or GitHub Copilot adapter to capture output.
                    </p>
                  </div>
                )}
                <RunAgentPanel
                  prompt={runPrompt}
                  runtimeAdapterId={runtimeAdapterId}
                  runtimeAdapters={adaptersQuery.data?.runtimeAdapters ?? []}
                  running={createRunMutation.isPending}
                  selectedWorkstreamId={selectedWorkstreamId}
                  setPrompt={setRunPrompt}
                  setRuntimeAdapterId={setRuntimeAdapterId}
                  onRun={() =>
                    selectedWorkstreamId &&
                    createRunMutation.mutate({
                      workstreamId: selectedWorkstreamId,
                      runtimeAdapterId,
                      prompt: runPrompt
                    })
                  }
                />
              </div>
            ) : null}

            <TimelinePanel
              actorFilter={actorFilter}
              actorOptions={actorOptions}
              autoScroll={autoScroll}
              eventGroups={eventGroups}
              selectedWorkstreamId={selectedWorkstreamId}
              setActorFilter={setActorFilter}
              setAutoScroll={setAutoScroll}
              setTypeFilter={setTypeFilter}
              timelineEndRef={timelineEndRef}
              typeFilter={typeFilter}
              typeOptions={typeOptions}
            />
          </CardContent>
        </Card>
      </section>
    </main>
  );
}

function StatusBadge({ status }: { status: WorkstreamStatus }) {
  const running = status === "running";

  return (
    <span
      className={`rounded-full px-2 py-1 text-xs font-medium ${
        running
          ? "bg-emerald-100 text-emerald-700"
          : "bg-slate-100 text-slate-700"
      }`}
    >
      {status}
    </span>
  );
}

function ServiceCard({
  service,
  logs,
  startPending,
  stopPending,
  onStart,
  onStop
}: {
  service: WorkstreamService;
  logs: WorkstreamEvent[];
  startPending: boolean;
  stopPending: boolean;
  onStart: () => void;
  onStop: () => void;
}) {
  const running = service.status === "starting" || service.status === "ready";

  return (
    <div className="rounded-xl border bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <h2 className="font-semibold">{service.name}</h2>
            <ServiceStatusBadge status={service.status} />
            <HealthIndicator healthy={service.healthy} />
          </div>
          <p className="font-mono text-xs text-slate-500">{service.command}</p>
          <a
            className="text-sm text-blue-600 hover:underline"
            href={service.localUrl}
            rel="noreferrer"
            target="_blank"
          >
            {service.localUrl}
          </a>
        </div>

        {running ? (
          <Button variant="outline" onClick={onStop} disabled={stopPending}>
            {stopPending ? "Stopping..." : "Stop"}
          </Button>
        ) : (
          <Button onClick={onStart} disabled={startPending}>
            {startPending ? "Starting..." : "Start"}
          </Button>
        )}
      </div>

      <div className="mt-4 rounded-lg bg-slate-950 p-3 font-mono text-xs text-slate-100">
        {logs.length > 0 ? (
          <ul className="max-h-48 space-y-1 overflow-auto">
            {logs.map((event) => (
              <li key={event.id}>
                <span className="text-slate-500">
                  {formatTime(event.createdAt)}
                </span>{" "}
                {event.message}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-slate-500">No service logs yet.</p>
        )}
      </div>
    </div>
  );
}

function RunAgentPanel({
  prompt,
  runtimeAdapterId,
  runtimeAdapters,
  running,
  selectedWorkstreamId,
  setPrompt,
  setRuntimeAdapterId,
  onRun
}: {
  prompt: string;
  runtimeAdapterId: string;
  runtimeAdapters: Pick<RuntimeAdapter, "id" | "displayName">[];
  running: boolean;
  selectedWorkstreamId: string | null;
  setPrompt: (prompt: string) => void;
  setRuntimeAdapterId: (runtimeAdapterId: string) => void;
  onRun: () => void;
}) {
  return (
    <div className="rounded-xl border bg-white p-4 shadow-sm">
      <div className="space-y-4">
        <div>
          <h2 className="font-semibold">Run Agent</h2>
          <p className="mt-1 text-sm text-slate-500">
            Pick a runtime adapter and send output to the timeline.
          </p>
        </div>

        <label className="block space-y-2 text-sm">
          <span className="font-medium">Runtime</span>
          <select
            className="w-full rounded-md border bg-white px-3 py-2"
            value={runtimeAdapterId}
            onChange={(event) => setRuntimeAdapterId(event.target.value)}
          >
            {runtimeAdapters.map((adapter) => (
              <option key={adapter.id} value={adapter.id}>
                {adapter.displayName}
              </option>
            ))}
          </select>
        </label>

        <label className="block space-y-2 text-sm">
          <span className="font-medium">Prompt</span>
          <textarea
            className="min-h-28 w-full rounded-md border px-3 py-2 font-mono text-sm"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="echo hello"
          />
        </label>

        <Button
          className="w-full"
          disabled={!selectedWorkstreamId || !prompt.trim() || running}
          onClick={onRun}
        >
          {running ? "Running..." : "Run"}
        </Button>
      </div>
    </div>
  );
}

type TimelineEventGroup = {
  id: string;
  actorType: WorkstreamEventActorType;
  actorId: string;
  type: WorkstreamEventType;
  createdAt: string;
  events: WorkstreamEvent[];
};

function TimelinePanel({
  actorFilter,
  actorOptions,
  autoScroll,
  eventGroups,
  selectedWorkstreamId,
  setActorFilter,
  setAutoScroll,
  setTypeFilter,
  timelineEndRef,
  typeFilter,
  typeOptions
}: {
  actorFilter: "all" | WorkstreamEventActorType;
  actorOptions: WorkstreamEventActorType[];
  autoScroll: boolean;
  eventGroups: TimelineEventGroup[];
  selectedWorkstreamId: string | null;
  setActorFilter: (actorType: "all" | WorkstreamEventActorType) => void;
  setAutoScroll: (autoScroll: boolean) => void;
  setTypeFilter: (type: "all" | WorkstreamEventType) => void;
  timelineEndRef: { current: HTMLDivElement | null };
  typeFilter: "all" | WorkstreamEventType;
  typeOptions: WorkstreamEventType[];
}) {
  return (
    <div className="flex min-h-[28rem] flex-1 flex-col overflow-hidden rounded-xl border bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4">
        <div className="flex items-center gap-2">
          <button className="rounded-md bg-slate-950 px-3 py-1.5 text-sm font-medium text-white">
            Timeline
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-3 text-sm">
          <label className="flex items-center gap-2">
            Actor
            <select
              className="rounded-md border bg-white px-2 py-1"
              value={actorFilter}
              onChange={(event) =>
                setActorFilter(event.target.value as "all" | WorkstreamEventActorType)
              }
            >
              <option value="all">all</option>
              {actorOptions.map((actorType) => (
                <option key={actorType} value={actorType}>
                  {actorType}
                </option>
              ))}
            </select>
          </label>

          <label className="flex items-center gap-2">
            Type
            <select
              className="max-w-52 rounded-md border bg-white px-2 py-1"
              value={typeFilter}
              onChange={(event) =>
                setTypeFilter(event.target.value as "all" | WorkstreamEventType)
              }
            >
              <option value="all">all</option>
              {typeOptions.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </label>

          <label className="flex items-center gap-2">
            <input
              checked={autoScroll}
              onChange={(event) => setAutoScroll(event.target.checked)}
              type="checkbox"
            />
            Auto-scroll
          </label>
        </div>
      </div>

      <div className="flex-1 space-y-3 overflow-auto bg-slate-50 p-4">
        {selectedWorkstreamId ? (
          eventGroups.length > 0 ? (
            eventGroups.map((group) => (
              <TimelineGroupCard group={group} key={group.id} />
            ))
          ) : (
            <p className="text-sm text-slate-500">No matching events.</p>
          )
        ) : (
          <p className="text-sm text-slate-500">No workstream selected.</p>
        )}
        <div ref={timelineEndRef} />
      </div>
    </div>
  );
}

function TimelineGroupCard({ group }: { group: TimelineEventGroup }) {
  return (
    <article className="rounded-xl border bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <ActorBadge actorType={group.actorType} />
            <span className="font-mono text-xs text-slate-500">
              {group.actorId}
            </span>
            <span className="rounded-full bg-slate-100 px-2 py-1 font-mono text-xs text-slate-700">
              {group.type}
            </span>
          </div>
          <p className="text-xs text-slate-500">
            {formatDate(group.createdAt)} · {group.events.length} event
            {group.events.length === 1 ? "" : "s"}
          </p>
        </div>
      </div>

      <div className="mt-4 space-y-3">
        {group.events.map((event) => (
          <div className="rounded-lg bg-slate-950 p-3 text-slate-100" key={event.id}>
            <div className="mb-2 font-mono text-xs text-slate-500">
              {formatTime(event.createdAt)}
            </div>
            <pre className="whitespace-pre-wrap font-mono text-sm">
              {event.message}
            </pre>
            {event.payloadJson ? (
              <details className="mt-2 text-xs text-slate-400">
                <summary className="cursor-pointer">payload</summary>
                <pre className="mt-2 whitespace-pre-wrap">
                  {formatPayload(event.payloadJson)}
                </pre>
              </details>
            ) : null}
          </div>
        ))}
      </div>
    </article>
  );
}

function ActorBadge({ actorType }: { actorType: WorkstreamEventActorType }) {
  const className = {
    system: "bg-slate-100 text-slate-700",
    service: "bg-purple-100 text-purple-700",
    agent: "bg-blue-100 text-blue-700",
    user: "bg-amber-100 text-amber-700"
  }[actorType];

  return (
    <span className={`rounded-full px-2 py-1 text-xs font-medium ${className}`}>
      {actorType}
    </span>
  );
}

function AgentRunCard({
  agentRun,
  events
}: {
  agentRun: AgentRun;
  events: WorkstreamEvent[];
}) {
  const outputTranscript = formatAgentTranscript(
    events
      .filter(
        (event) =>
          event.type === "agent.output.chunk" && event.actorId === agentRun.id
      )
      .map((event) => event.message)
      .join("\n")
  );

  return (
    <div className="rounded-xl border bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-2">
          <div className="flex items-center gap-2">
            <h2 className="font-semibold">Agent run</h2>
            <AgentRunStatusBadge status={agentRun.status} />
          </div>
          <p className="font-mono text-xs text-slate-500">
            {agentRun.command}
          </p>
          <p className="text-xs text-slate-500">
            {agentRun.startedAt
              ? `Started ${formatDate(agentRun.startedAt)}`
              : "Queued"}
            {agentRun.completedAt
              ? ` · Completed ${formatDate(agentRun.completedAt)}`
              : null}
          </p>
        </div>
      </div>

      <div className="mt-4 rounded-lg bg-slate-950 p-3 font-mono text-xs text-slate-100">
        {outputTranscript.length > 0 ? (
          <pre className="max-h-48 overflow-auto whitespace-pre-wrap">
            {outputTranscript}
          </pre>
        ) : (
          <p className="text-slate-500">No agent output yet.</p>
        )}
      </div>
    </div>
  );
}

function AgentRunStatusBadge({ status }: { status: AgentRun["status"] }) {
  const className = {
    queued: "bg-slate-100 text-slate-700",
    running: "bg-blue-100 text-blue-700",
    completed: "bg-emerald-100 text-emerald-700",
    failed: "bg-red-100 text-red-700"
  }[status];

  return (
    <span className={`rounded-full px-2 py-1 text-xs font-medium ${className}`}>
      {status}
    </span>
  );
}

function ServiceStatusBadge({ status }: { status: ServiceStatus }) {
  const className = {
    stopped: "bg-slate-100 text-slate-700",
    starting: "bg-amber-100 text-amber-700",
    ready: "bg-emerald-100 text-emerald-700",
    failed: "bg-red-100 text-red-700"
  }[status];

  return (
    <span className={`rounded-full px-2 py-1 text-xs font-medium ${className}`}>
      {status}
    </span>
  );
}

function HealthIndicator({ healthy }: { healthy: boolean }) {
  return (
    <span className="flex items-center gap-1 text-xs text-slate-600">
      <span
        className={`h-2 w-2 rounded-full ${
          healthy ? "bg-emerald-500" : "bg-slate-300"
        }`}
      />
      {healthy ? "healthy" : "not healthy"}
    </span>
  );
}

function shortId(id: string) {
  return id.slice(0, 8);
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(value));
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit"
  }).format(new Date(value));
}

function formatAgentTranscript(value: string) {
  return value
    .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "")
    .replace(/\r/g, "")
    .replace(/[ \t]*\n[ \t]*/g, " ")
    .replace(/(\d)\s+(?=\d)/g, "$1")
    .replace(/([`([{])\s+/g, "$1")
    .replace(/`\s*([^`]*?)\s*`/g, "`$1`")
    .replace(/\s+([\])}.,;:!?])/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function groupTimelineEvents(events: WorkstreamEvent[]): TimelineEventGroup[] {
  const groups: TimelineEventGroup[] = [];

  for (const event of events) {
    const previous = groups.at(-1);
    if (previous && shouldAppendToGroup(previous, event)) {
      previous.events.push(event);
      continue;
    }

    groups.push({
      id: event.id,
      actorType: event.actorType,
      actorId: event.actorId,
      type: event.type,
      createdAt: event.createdAt,
      events: [event]
    });
  }

  return groups;
}

function shouldAppendToGroup(
  group: TimelineEventGroup,
  event: WorkstreamEvent
) {
  return (
    group.actorType === event.actorType &&
    group.actorId === event.actorId &&
    group.type === event.type &&
    new Date(event.createdAt).getTime() - new Date(group.createdAt).getTime() <
      60_000
  );
}

function formatPayload(payloadJson: string) {
  try {
    return JSON.stringify(JSON.parse(payloadJson), null, 2);
  } catch {
    return payloadJson;
  }
}
