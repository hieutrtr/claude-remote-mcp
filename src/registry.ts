import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { hostname } from "node:os";
import path from "node:path";
import lockfile from "proper-lockfile";
import { dataHome, lockFilePath, stateFilePath } from "./paths.js";
import { pidAlive } from "./platform.js";
import {
  type SessionEntry,
  type StateFile,
  StateFileSchema,
} from "./types.js";
import { ADJECTIVES, NOUNS } from "./wordlists.js";
import { CrmError, ErrorCodes } from "./errors.js";

const EMPTY_STATE: StateFile = {
  schema_version: 1,
  sessions: [],
};

export function ensureDataHome(): void {
  const dir = dataHome();
  mkdirSync(dir, { recursive: true });
  mkdirSync(path.join(dir, "logs"), { recursive: true });
}

export function readState(): StateFile {
  ensureDataHome();
  const file = stateFilePath();
  if (!existsSync(file)) {
    return structuredClone(EMPTY_STATE);
  }
  try {
    const raw = readFileSync(file, "utf8");
    if (raw.trim().length === 0) return structuredClone(EMPTY_STATE);
    const parsed = JSON.parse(raw);
    return StateFileSchema.parse(parsed);
  } catch (err) {
    throw new CrmError(
      ErrorCodes.STATE_LOCK_TIMEOUT,
      `Cannot parse state file at ${file}: ${(err as Error).message}`,
      { details: { file } },
    );
  }
}

export function writeStateAtomic(state: StateFile): void {
  ensureDataHome();
  const file = stateFilePath();
  const tmp = `${file}.tmp.${process.pid}.${Date.now()}`;
  writeFileSync(tmp, JSON.stringify(state, null, 2), {
    encoding: "utf8",
    mode: 0o600,
  });
  renameSync(tmp, file);
}

export async function mutate<T>(
  fn: (state: StateFile) => { state: StateFile; result: T },
): Promise<T> {
  ensureDataHome();
  const file = stateFilePath();
  if (!existsSync(file)) {
    writeStateAtomic(structuredClone(EMPTY_STATE));
  }

  const release = await lockfile.lock(file, {
    lockfilePath: lockFilePath(),
    retries: { retries: 500, factor: 1.1, minTimeout: 20, maxTimeout: 200 },
    stale: 10_000,
  });

  try {
    const current = readState();
    const { state, result } = fn(current);
    writeStateAtomic(state);
    return result;
  } finally {
    await release();
  }
}

export async function reconcile(): Promise<{ flipped: number }> {
  return mutate((state) => {
    let flipped = 0;
    const now = new Date().toISOString();
    for (const entry of state.sessions) {
      if (entry.status !== "alive") continue;
      if (entry.owner_hostname !== hostname()) continue;
      if (!pidAlive(entry.pid)) {
        entry.status = "dead";
        entry.died_at = now;
        flipped += 1;
      }
    }
    return { state, result: { flipped } };
  });
}

export function generateSessionId(existing: Set<string>): string {
  for (let i = 0; i < 100; i++) {
    const adj = pick(ADJECTIVES);
    const noun = pick(NOUNS);
    const id = `${shortHost()}-${adj}-${noun}`;
    if (!existing.has(id)) return id;
  }
  throw new Error("Unable to generate unique session id");
}

function pick<T>(arr: readonly T[]): T {
  const idx = Math.floor(Math.random() * arr.length);
  const v = arr[idx];
  if (v === undefined) throw new Error("pick: empty array");
  return v;
}

function shortHost(): string {
  return hostname()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 16) || "local";
}

export function findSession(
  state: StateFile,
  opts: { session_id?: string; pid?: number },
): SessionEntry | undefined {
  if (opts.session_id !== undefined) {
    return state.sessions.find((s) => s.session_id === opts.session_id);
  }
  if (opts.pid !== undefined) {
    return state.sessions.find((s) => s.pid === opts.pid);
  }
  return undefined;
}
