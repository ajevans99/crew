import Database from "better-sqlite3";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { Readable } from "node:stream";

export type WorkstreamStatus = "idle" | "running";

export type Workstream = {
  id: string;
  createdAt: string;
  status: WorkstreamStatus;
  portBase: number;
};

export type ServiceDefinition = {
  name: string;
  command: string;
  cwd: string;
  portEnvName: string;
  healthUrl: string;
};

export type AgentRunStatus = "queued" | "running" | "completed" | "failed";

export type AgentRun = {
  id: string;
  workstreamId: string;
  status: AgentRunStatus;
  command: string;
  startedAt: string | null;
  completedAt: string | null;
};

export type WorkstreamEventActorType = "system" | "service" | "agent" | "user";

export type WorkstreamEventType =
  | "workstream.created"
  | "service.started"
  | "service.output.chunk"
  | "service.stopped"
  | "agent.run.started"
  | "agent.output.chunk"
  | "agent.run.completed"
  | "agent.run.failed"
  | "user.command.requested";

export type WorkstreamEvent = {
  id: string;
  workstreamId: string;
  actorType: WorkstreamEventActorType;
  actorId: string;
  type: WorkstreamEventType;
  message: string;
  payloadJson: string | null;
  createdAt: string;
};

type WorkstreamRow = {
  id: string;
  created_at: string;
  status: WorkstreamStatus;
  port_base: number;
};

type EventRow = {
  id: string;
  workstream_id: string;
  actor_type: WorkstreamEventActorType;
  actor_id: string;
  type: WorkstreamEventType;
  message: string;
  payload_json: string | null;
  created_at: string;
};

type AgentRunRow = {
  id: string;
  workstream_id: string;
  status: AgentRunStatus;
  command: string;
  started_at: string | null;
  completed_at: string | null;
};

const databases = new Map<string, Database.Database>();

export class WorkstreamNotFoundError extends Error {
  constructor(id: string) {
    super(`Workstream not found: ${id}`);
    this.name = "WorkstreamNotFoundError";
  }
}

export function getDatabase(dbPath = defaultDbPath()) {
  const existing = databases.get(dbPath);
  if (existing) {
    return existing;
  }

  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  migrate(db);
  databases.set(dbPath, db);
  return db;
}

export function createWorkstream(db = getDatabase()): Workstream {
  const workstream: Workstream = {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    status: "idle",
    portBase: nextPortBase(db)
  };

  db.prepare(
    "INSERT INTO workstreams (id, created_at, status, port_base) VALUES (?, ?, ?, ?)"
  ).run(
    workstream.id,
    workstream.createdAt,
    workstream.status,
    workstream.portBase
  );

  appendEvent(
    {
      workstreamId: workstream.id,
      actorType: "system",
      actorId: "crew",
      type: "workstream.created",
      message: "Workstream created",
      payload: { portBase: workstream.portBase }
    },
    db
  );

  return workstream;
}

export function listWorkstreams(db = getDatabase()): Workstream[] {
  const rows = db
    .prepare(
      `SELECT id, created_at, status, port_base
       FROM workstreams
       ORDER BY created_at DESC`
    )
    .all() as WorkstreamRow[];

  return rows.map(toWorkstream);
}

export function getWorkstream(
  workstreamId: string,
  db = getDatabase()
): Workstream {
  const row = db
    .prepare(
      `SELECT id, created_at, status, port_base
       FROM workstreams
       WHERE id = ?`
    )
    .get(workstreamId) as WorkstreamRow | undefined;

  if (!row) {
    throw new WorkstreamNotFoundError(workstreamId);
  }

  return toWorkstream(row);
}

export function getEvents(
  workstreamId: string,
  db = getDatabase()
): WorkstreamEvent[] {
  ensureWorkstreamExists(workstreamId, db);

  const rows = db
    .prepare(
      `SELECT id, workstream_id, actor_type, actor_id, type, message, payload_json, created_at
       FROM events
       WHERE workstream_id = ?
       ORDER BY created_at ASC, rowid ASC`
    )
    .all(workstreamId) as EventRow[];

  return rows.map(toEvent);
}

export function createAgentRun(
  workstreamId: string,
  command: string,
  db = getDatabase()
): AgentRun {
  ensureWorkstreamExists(workstreamId, db);

  const agentRun: AgentRun = {
    id: randomUUID(),
    workstreamId,
    status: "queued",
    command,
    startedAt: null,
    completedAt: null
  };

  db.prepare(
    `INSERT INTO agent_runs (id, workstream_id, status, command, started_at, completed_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    agentRun.id,
    agentRun.workstreamId,
    agentRun.status,
    agentRun.command,
    agentRun.startedAt,
    agentRun.completedAt
  );

  return agentRun;
}

export function listAgentRuns(
  workstreamId: string,
  db = getDatabase()
): AgentRun[] {
  ensureWorkstreamExists(workstreamId, db);

  const rows = db
    .prepare(
      `SELECT id, workstream_id, status, command, started_at, completed_at
       FROM agent_runs
       WHERE workstream_id = ?
       ORDER BY rowid DESC`
    )
    .all(workstreamId) as AgentRunRow[];

  return rows.map(toAgentRun);
}

export function updateAgentRunStatus(
  agentRunId: string,
  status: AgentRunStatus,
  db = getDatabase()
): AgentRun {
  const current = db
    .prepare(
      `SELECT id, workstream_id, status, command, started_at, completed_at
       FROM agent_runs
       WHERE id = ?`
    )
    .get(agentRunId) as AgentRunRow | undefined;

  if (!current) {
    throw new Error(`Agent run not found: ${agentRunId}`);
  }

  const startedAt =
    status === "running" && current.started_at === null
      ? new Date().toISOString()
      : current.started_at;
  const completedAt =
    status === "completed" || status === "failed"
      ? new Date().toISOString()
      : current.completed_at;

  db.prepare(
    `UPDATE agent_runs
     SET status = ?, started_at = ?, completed_at = ?
     WHERE id = ?`
  ).run(status, startedAt, completedAt, agentRunId);

  return {
    id: current.id,
    workstreamId: current.workstream_id,
    command: current.command,
    status,
    startedAt,
    completedAt
  };
}

export async function runHelloCommand(
  workstreamId: string,
  db = getDatabase(),
  onEvent?: (event: WorkstreamEvent) => void
) {
  ensureWorkstreamExists(workstreamId, db);
  setWorkstreamStatus(workstreamId, "running", db);

  const requestedEvent = appendEvent(
    {
      workstreamId,
      actorType: "user",
      actorId: "web",
      type: "user.command.requested",
      message: "echo hello",
      payload: { command: "echo", args: ["hello"] }
    },
    db
  );
  onEvent?.(requestedEvent);

  try {
    await runCommand({
      command: "echo",
      args: ["hello"],
      onLine: (line) => {
        const event = appendEvent(
          {
            workstreamId,
            actorType: "system",
            actorId: "command",
            type: "user.command.requested",
            message: line,
            payload: { command: "echo", stream: "stdout" }
          },
          db
        );
        onEvent?.(event);
      }
    });
  } finally {
    setWorkstreamStatus(workstreamId, "idle", db);
  }
}

function defaultDbPath() {
  return process.env.CREW_DB_PATH?.trim() || join(process.cwd(), "crew.sqlite");
}

function migrate(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS workstreams (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('idle', 'running')),
      port_base INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      workstream_id TEXT NOT NULL,
      actor_type TEXT NOT NULL,
      actor_id TEXT NOT NULL,
      type TEXT NOT NULL,
      message TEXT NOT NULL,
      payload_json TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (workstream_id) REFERENCES workstreams(id)
    );

    CREATE TABLE IF NOT EXISTS agent_runs (
      id TEXT PRIMARY KEY,
      workstream_id TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed')),
      command TEXT NOT NULL,
      started_at TEXT,
      completed_at TEXT,
      FOREIGN KEY (workstream_id) REFERENCES workstreams(id)
    );
  `);

  const columns = db.prepare("PRAGMA table_info(workstreams)").all() as {
    name: string;
  }[];
  if (!columns.some((column) => column.name === "port_base")) {
    db.exec("ALTER TABLE workstreams ADD COLUMN port_base INTEGER");
    db.exec(`
      UPDATE workstreams
      SET port_base = 4100 + ((rowid - 1) * 10)
      WHERE port_base IS NULL
    `);
  }

  const eventColumns = db.prepare("PRAGMA table_info(events)").all() as {
    name: string;
  }[];
  const eventColumnNames = new Set(eventColumns.map((column) => column.name));

  if (!eventColumnNames.has("actor_type")) {
    db.exec("ALTER TABLE events ADD COLUMN actor_type TEXT");
  }
  if (!eventColumnNames.has("actor_id")) {
    db.exec("ALTER TABLE events ADD COLUMN actor_id TEXT");
  }
  if (!eventColumnNames.has("payload_json")) {
    db.exec("ALTER TABLE events ADD COLUMN payload_json TEXT");
  }
  if (!eventColumnNames.has("created_at")) {
    db.exec("ALTER TABLE events ADD COLUMN created_at TEXT");
  }

  const legacyCreatedAt = eventColumnNames.has("timestamp")
    ? "timestamp"
    : "datetime('now')";

  db.exec(`
    UPDATE events
    SET
      created_at = COALESCE(created_at, ${legacyCreatedAt}, datetime('now')),
      actor_type = COALESCE(
        actor_type,
        CASE
          WHEN type LIKE 'agent.%' THEN 'agent'
          WHEN message LIKE '[web]%' THEN 'service'
          ELSE 'system'
        END
      ),
      actor_id = COALESCE(
        actor_id,
        CASE
          WHEN type LIKE 'agent.%' THEN 'legacy-agent'
          WHEN message LIKE '[web]%' THEN 'web'
          ELSE 'crew'
        END
      ),
      type = CASE
        WHEN type = 'log' AND message LIKE '[web]%' THEN 'service.output.chunk'
        WHEN type = 'log' THEN 'user.command.requested'
        ELSE type
      END
    WHERE created_at IS NULL OR actor_type IS NULL OR actor_id IS NULL OR type = 'log'
  `);
}

function ensureWorkstreamExists(workstreamId: string, db: Database.Database) {
  const row = db
    .prepare("SELECT id FROM workstreams WHERE id = ?")
    .get(workstreamId);

  if (!row) {
    throw new WorkstreamNotFoundError(workstreamId);
  }
}

function setWorkstreamStatus(
  workstreamId: string,
  status: WorkstreamStatus,
  db: Database.Database
) {
  db.prepare("UPDATE workstreams SET status = ? WHERE id = ?").run(
    status,
    workstreamId
  );
}

export function appendEvent(
  input: {
    workstreamId: string;
    actorType: WorkstreamEventActorType;
    actorId: string;
    type: WorkstreamEventType;
    message: string;
    payload?: unknown;
  },
  db = getDatabase()
): WorkstreamEvent {
  ensureWorkstreamExists(input.workstreamId, db);

  const event: WorkstreamEvent = {
    id: randomUUID(),
    workstreamId: input.workstreamId,
    actorType: input.actorType,
    actorId: input.actorId,
    type: input.type,
    message: input.message,
    payloadJson:
      input.payload === undefined ? null : JSON.stringify(input.payload),
    createdAt: new Date().toISOString()
  };

  db.prepare(
    `INSERT INTO events (
       id, workstream_id, actor_type, actor_id, type, message, payload_json, created_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    event.id,
    event.workstreamId,
    event.actorType,
    event.actorId,
    event.type,
    event.message,
    event.payloadJson,
    event.createdAt
  );

  return event;
}

async function runCommand({
  command,
  args,
  onLine
}: {
  command: string;
  args: string[];
  onLine: (line: string) => void;
}) {
  const child = spawn(command, args, {
    stdio: ["ignore", "pipe", "pipe"]
  });

  const stdout = streamLines(child.stdout, onLine);
  const stderr = streamLines(child.stderr, onLine);
  const result = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
    (resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code, signal) => resolve({ code, signal }));
    }
  );

  await Promise.all([stdout, stderr]);

  if (result.code !== 0) {
    throw new Error(
      `${command} exited with code ${result.code ?? "null"} and signal ${
        result.signal ?? "null"
      }`
    );
  }
}

function streamLines(stream: Readable | null, onLine: (line: string) => void) {
  return new Promise<void>((resolve, reject) => {
    if (!stream) {
      resolve();
      return;
    }

    let buffer = "";
    stream.setEncoding("utf8");
    stream.on("data", (chunk: string) => {
      buffer += chunk;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        onLine(line);
      }
    });
    stream.once("end", () => {
      if (buffer.length > 0) {
        onLine(buffer);
      }
      resolve();
    });
    stream.once("error", reject);
  });
}

function toEvent(row: EventRow): WorkstreamEvent {
  return {
    id: row.id,
    workstreamId: row.workstream_id,
    actorType: row.actor_type,
    actorId: row.actor_id,
    type: row.type,
    message: row.message,
    payloadJson: row.payload_json,
    createdAt: row.created_at
  };
}

function toWorkstream(row: WorkstreamRow): Workstream {
  return {
    id: row.id,
    createdAt: row.created_at,
    status: row.status,
    portBase: row.port_base
  };
}

function toAgentRun(row: AgentRunRow): AgentRun {
  return {
    id: row.id,
    workstreamId: row.workstream_id,
    status: row.status,
    command: row.command,
    startedAt: row.started_at,
    completedAt: row.completed_at
  };
}

function nextPortBase(db: Database.Database) {
  const row = db
    .prepare("SELECT MAX(port_base) as max_port_base FROM workstreams")
    .get() as { max_port_base: number | null };

  return row.max_port_base === null ? 4100 : row.max_port_base + 10;
}
