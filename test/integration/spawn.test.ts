import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { handler as spawnHandler } from "../../src/tools/spawnRemote.js";
import { handler as listHandler } from "../../src/tools/listSessions.js";
import { handler as stopHandler } from "../../src/tools/stopSession.js";
import { gracefulKill, pidAlive } from "../../src/platform.js";
import { runCommand } from "../../src/claudeCli.js";

function makeFakeClaude(dir: string): string {
  const script = `#!/usr/bin/env bash
echo "Boot..."
echo "Open: https://claude.ai/code/fake-$$-$RANDOM"
echo "Ready"
sleep 60
`;
  const file = path.join(dir, "claude");
  writeFileSync(file, script, { encoding: "utf8" });
  chmodSync(file, 0o755);
  return file;
}

describe("spawn_remote_session integration", () => {
  let tmpHome: string;
  let tmpBin: string;
  let prevHome: string | undefined;
  let prevBin: string | undefined;

  beforeEach(() => {
    tmpHome = mkdtempSync(path.join(tmpdir(), "crm-spawn-home-"));
    tmpBin = mkdtempSync(path.join(tmpdir(), "crm-spawn-bin-"));
    prevHome = process.env["CLAUDE_REMOTE_MCP_HOME"];
    prevBin = process.env["CLAUDE_BIN"];
    process.env["CLAUDE_REMOTE_MCP_HOME"] = tmpHome;
    process.env["CLAUDE_BIN"] = makeFakeClaude(tmpBin);
  });

  afterEach(async () => {
    if (prevHome === undefined) delete process.env["CLAUDE_REMOTE_MCP_HOME"];
    else process.env["CLAUDE_REMOTE_MCP_HOME"] = prevHome;
    if (prevBin === undefined) delete process.env["CLAUDE_BIN"];
    else process.env["CLAUDE_BIN"] = prevBin;
    rmSync(tmpHome, { recursive: true, force: true });
    rmSync(tmpBin, { recursive: true, force: true });
  });

  it("spawns, registers, lists, then stops", async () => {
    const folder = path.join(tmpHome, "workdir");
    const result = (await spawnHandler({ folder, name: "smoke" })) as {
      session_id: string;
      pid: number;
      url: string;
      working_dir: string;
      status: string;
    };

    expect(result.url).toMatch(/https:\/\/claude\.ai\/code\/fake-/);
    expect(result.working_dir).toBe(folder);
    expect(result.status).toBe("alive");
    expect(pidAlive(result.pid)).toBe(true);

    const listed = (await listHandler({})) as {
      sessions: Array<{ session_id: string; status: string }>;
      total: number;
    };
    expect(listed.total).toBe(1);
    expect(listed.sessions[0]?.session_id).toBe(result.session_id);

    const stopped = (await stopHandler({ session_id: result.session_id })) as {
      killed: boolean;
      signal: string;
    };
    expect(stopped.killed).toBe(true);
    expect(["SIGTERM", "SIGKILL"]).toContain(stopped.signal);
    expect(pidAlive(result.pid)).toBe(false);

    const after = (await listHandler({ only_alive: true })) as { total: number };
    expect(after.total).toBe(0);
  });

  it("resolves relative folder against CLAUDE_PROJECT_DIR, not process.cwd", async () => {
    const projectDir = mkdtempSync(path.join(tmpdir(), "crm-proj-"));
    const prevProj = process.env["CLAUDE_PROJECT_DIR"];
    process.env["CLAUDE_PROJECT_DIR"] = projectDir;
    try {
      const result = (await spawnHandler({
        folder: "./inner-session",
        name: "rel-test",
      })) as { working_dir: string; pid: number };
      expect(result.working_dir).toBe(path.join(projectDir, "inner-session"));
      expect(existsSync(result.working_dir)).toBe(true);
      await gracefulKill(result.pid, 2000);
    } finally {
      if (prevProj === undefined) delete process.env["CLAUDE_PROJECT_DIR"];
      else process.env["CLAUDE_PROJECT_DIR"] = prevProj;
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("with git_init=true runs `git init` and creates an initial commit", async () => {
    const folder = path.join(tmpHome, "fresh-repo");
    const result = (await spawnHandler({
      folder,
      name: "fresh",
      git_init: true,
    })) as { working_dir: string; pid: number };

    expect(existsSync(path.join(result.working_dir, ".git"))).toBe(true);
    const log = await runCommand("git", ["log", "--oneline"], {
      cwd: result.working_dir,
      timeoutMs: 5000,
    });
    expect(log.exitCode).toBe(0);
    expect(log.stdout).toMatch(/Initial commit/);

    const branch = await runCommand("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd: result.working_dir,
      timeoutMs: 5000,
    });
    expect(branch.stdout.trim()).toBe("main");
    await gracefulKill(result.pid, 2000);
  });

  it("git_init=true is rejected with spawn_mode=worktree", async () => {
    await expect(
      spawnHandler({
        folder: path.join(tmpHome, "x"),
        spawn_mode: "worktree",
        git_init: true,
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("times out when fake binary does not print URL", async () => {
    const slowScript = `#!/usr/bin/env bash
echo "no url here"
sleep 5
`;
    const slow = path.join(tmpBin, "claude-slow");
    writeFileSync(slow, slowScript);
    chmodSync(slow, 0o755);
    process.env["CLAUDE_BIN"] = slow;

    const folder = path.join(tmpHome, "workdir2");
    process.env["CLAUDE_REMOTE_MCP_URL_TIMEOUT_MS"] = "0";

    await expect(
      spawnHandler({ folder, name: "should-fail" }),
    ).rejects.toMatchObject({ code: "URL_TIMEOUT" });
  }, 60_000);
});
