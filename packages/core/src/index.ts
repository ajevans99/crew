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
};

export type WorkstreamEvent = {
  id: string;
  workstreamId: string;
  type: "log";
  message: string;
  timestamp: string;
};

type WorkstreamRow = {
  id: string;
  created_at: string;
  status: WorkstreamStatus;
};

type EventRow = {
  id: string;
  workstream_id: string;
  type: "log";
  message: string;
  timestamp: string;
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
    status: "idle"
  };

  db.prepare(
    "INSERT INTO workstreams (id, created_at, status) VALUES (?, ?, ?)"
  ).run(workstream.id, workstream.createdAt, workstream.status);

  return workstream;
}

export function getEvents(
  workstreamId: string,
  db = getDatabase()
): WorkstreamEvent[] {
  ensureWorkstreamExists(workstreamId, db);

  const rows = db
    .prepare(
      `SELECT id, workstream_id, type, message, timestamp
       FROM events
       WHERE workstream_id = ?
       ORDER BY rowid ASC`
    )
    .all(workstreamId) as EventRow[];

  return rows.map(toEvent);
}

export async function runHelloCommand(
  workstreamId: string,
  db = getDatabase(),
  onEvent?: (event: WorkstreamEvent) => void
) {
  ensureWorkstreamExists(workstreamId, db);
  setWorkstreamStatus(workstreamId, "running", db);

  try {
    await runCommand({
      command: "echo",
      args: ["hello"],
      onLine: (line) => {
        const event = createEvent(workstreamId, line, db);
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
      status TEXT NOT NULL CHECK (status IN ('idle', 'running'))
    );

    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      workstream_id TEXT NOT NULL,
      type TEXT NOT NULL,
      message TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      FOREIGN KEY (workstream_id) REFERENCES workstreams(id)
    );
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

function createEvent(
  workstreamId: string,
  message: string,
  db: Database.Database
): WorkstreamEvent {
  const event: WorkstreamEvent = {
    id: randomUUID(),
    workstreamId,
    type: "log",
    message,
    timestamp: new Date().toISOString()
  };

  db.prepare(
    `INSERT INTO events (id, workstream_id, type, message, timestamp)
     VALUES (?, ?, 'log', ?, ?)`
  ).run(event.id, event.workstreamId, event.message, event.timestamp);

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
    type: row.type,
    message: row.message,
    timestamp: row.timestamp
  };
}
