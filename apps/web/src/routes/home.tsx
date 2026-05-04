import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { WorkstreamEvent } from "@crew/core";
import { createWorkstream, getEvents, runCommand } from "@/api";
import { useCrewStore } from "@/store";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function HomePage() {
  const queryClient = useQueryClient();
  const { workstreamId, setWorkstreamId } = useCrewStore();

  const eventsQuery = useQuery({
    queryKey: ["events", workstreamId],
    queryFn: () => getEvents(workstreamId!),
    enabled: Boolean(workstreamId)
  });

  const createWorkstreamMutation = useMutation({
    mutationFn: createWorkstream,
    onSuccess: ({ id }) => {
      setWorkstreamId(id);
      queryClient.setQueryData(["events", id], []);
    }
  });

  const runCommandMutation = useMutation({
    mutationFn: runCommand,
    onSuccess: () => {
      if (workstreamId) {
        queryClient.invalidateQueries({ queryKey: ["events", workstreamId] });
      }
    }
  });

  useEffect(() => {
    if (!workstreamId) {
      return;
    }

    const source = new EventSource(`/api/workstreams/${workstreamId}/events/stream`);

    source.onmessage = (message) => {
      const event = JSON.parse(message.data) as WorkstreamEvent;
      queryClient.setQueryData<WorkstreamEvent[]>(
        ["events", workstreamId],
        (current = []) => {
          if (current.some((existing) => existing.id === event.id)) {
            return current;
          }

          return [...current, event];
        }
      );
    };

    return () => source.close();
  }, [queryClient, workstreamId]);

  const events = eventsQuery.data ?? [];
  const error =
    createWorkstreamMutation.error ?? runCommandMutation.error ?? eventsQuery.error;

  return (
    <main className="min-h-screen bg-slate-50 px-6 py-10">
      <Card className="mx-auto max-w-3xl">
        <CardHeader>
          <CardTitle className="text-2xl">Crew</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex flex-wrap gap-3">
            <Button
              onClick={() => createWorkstreamMutation.mutate()}
              disabled={createWorkstreamMutation.isPending || runCommandMutation.isPending}
            >
              {createWorkstreamMutation.isPending ? "Creating..." : "Create Workstream"}
            </Button>
            <Button
              variant="outline"
              onClick={() => workstreamId && runCommandMutation.mutate(workstreamId)}
              disabled={!workstreamId || createWorkstreamMutation.isPending || runCommandMutation.isPending}
            >
              {runCommandMutation.isPending ? "Running..." : "Run Command"}
            </Button>
          </div>

          {workstreamId ? (
            <p className="text-sm text-slate-600">Workstream: {workstreamId}</p>
          ) : (
            <p className="text-sm text-slate-600">
              Create a workstream, then run the hardcoded command.
            </p>
          )}

          {error ? (
            <p className="text-sm text-red-600">
              {error instanceof Error ? error.message : "Something went wrong"}
            </p>
          ) : null}

          <div className="rounded-lg bg-slate-950 p-4 font-mono text-sm text-slate-100">
            {events.length > 0 ? (
              <ul className="space-y-1">
                {events.map((event) => (
                  <li key={event.id}>{event.message}</li>
                ))}
              </ul>
            ) : (
              <p className="text-slate-500">No logs yet.</p>
            )}
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
