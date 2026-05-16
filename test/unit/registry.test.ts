import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { generateSessionId, mutate, readState, reconcile } from "../../src/registry.js";
import type { SessionEntry } from "../../src/types.js";
import { hostname } from "node:os";

function makeEntry(overrides: Partial<SessionEntry> = {}): SessionEntry {
  return {
    session_id: `host-graceful-otter-${Math.random().toString(36).slice(2)}`,
    name: "test",
    url: "https://claude.ai/code/abc",
    qr_ascii: "",
    pid: 99_999_998,
    working_dir: "/tmp/whatever",
    spawn_mode: "same-dir",
    worktree_branch: null,
    sandbox: false,
    tags: [],
    owner_orchestrator_pid: 1,
    owner_hostname: hostname(),
    started_at: new Date().toISOString(),
    stopped_at: null,
    died_at: null,
    status: "alive",
    ...overrides,
  };
}

describe("registry", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(path.join(tmpdir(), "crm-test-"));
    process.env["CLAUDE_REMOTE_MCP_HOME"] = tmp;
  });

  afterEach(() => {
    delete process.env["CLAUDE_REMOTE_MCP_HOME"];
    rmSync(tmp, { recursive: true, force: true });
  });

  it("readState returns empty state when file missing", () => {
    const s = readState();
    expect(s.sessions).toEqual([]);
    expect(s.schema_version).toBe(1);
  });

  it("mutate persists sessions atomically", async () => {
    const e1 = makeEntry();
    await mutate((state) => {
      state.sessions.push(e1);
      return { state, result: undefined };
    });
    const back = readState();
    expect(back.sessions.length).toBe(1);
    expect(back.sessions[0]?.session_id).toBe(e1.session_id);
  });

  it("mutate handles 100 parallel writes without corruption", async () => {
    const ops = Array.from({ length: 100 }, (_, i) =>
      mutate((state) => {
        state.sessions.push(makeEntry({ session_id: `s-${i}` }));
        return { state, result: undefined };
      }),
    );
    await Promise.all(ops);
    const back = readState();
    expect(back.sessions.length).toBe(100);
    const ids = new Set(back.sessions.map((s) => s.session_id));
    expect(ids.size).toBe(100);
  });

  it("reconcile flips alive → dead for non-existent pid", async () => {
    await mutate((state) => {
      state.sessions.push(makeEntry({ pid: 99_999_998, status: "alive" }));
      return { state, result: undefined };
    });
    const res = await reconcile();
    expect(res.flipped).toBe(1);
    const back = readState();
    expect(back.sessions[0]?.status).toBe("dead");
    expect(back.sessions[0]?.died_at).toBeTruthy();
  });

  it("reconcile does not flip current pid", async () => {
    await mutate((state) => {
      state.sessions.push(makeEntry({ pid: process.pid, status: "alive" }));
      return { state, result: undefined };
    });
    const res = await reconcile();
    expect(res.flipped).toBe(0);
  });

  it("generateSessionId returns unique-ish ids", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 20; i++) {
      const id = generateSessionId(seen);
      expect(id).toMatch(/-[a-z]+-[a-z]+$/);
      seen.add(id);
    }
    expect(seen.size).toBe(20);
  });
});
