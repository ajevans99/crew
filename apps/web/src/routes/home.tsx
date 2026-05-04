import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { WorkstreamStatus } from "@crew/core";
import {
  createWorkstream,
  getEvents,
  getWorkstream,
  listWorkstreams,
  runCommand
} from "@/api";
import { useCrewStore } from "@/store";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function HomePage() {
  const queryClient = useQueryClient();
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

  const selectedWorkstream = selectedWorkstreamQuery.data;
  const events = eventsQuery.data ?? [];
  const error =
    createWorkstreamMutation.error ??
    runCommandMutation.error ??
    workstreamsQuery.error ??
    selectedWorkstreamQuery.error ??
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

            <div className="min-h-[24rem] flex-1 overflow-auto rounded-lg bg-slate-950 p-4 font-mono text-sm text-slate-100">
              {selectedWorkstreamId ? (
                events.length > 0 ? (
                  <ul className="space-y-1">
                    {events.map((event) => (
                      <li key={event.id}>
                        <span className="text-slate-500">
                          {formatTime(event.timestamp)}
                        </span>{" "}
                        {event.message}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-slate-500">No logs yet.</p>
                )
              ) : (
                <p className="text-slate-500">No workstream selected.</p>
              )}
            </div>
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
