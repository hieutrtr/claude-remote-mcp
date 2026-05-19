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

  it("writes .claude/settings.local.json with bypassPermissions by default", async () => {
    const folder = path.join(tmpHome, "bypass-dir");
    const result = (await spawnHandler({
      folder,
      name: "bypass",
    })) as { working_dir: string; pid: number };

    const settingsPath = path.join(result.working_dir, ".claude", "settings.local.json");
    expect(existsSync(settingsPath)).toBe(true);
    const settings = JSON.parse(
      (await import("node:fs")).readFileSync(settingsPath, "utf8"),
    ) as { permissions?: { defaultMode?: string } };
    expect(settings.permissions?.defaultMode).toBe("bypassPermissions");
    await gracefulKill(result.pid, 2000);
  });

  it("preserves other keys in settings.local.json when merging bypassPermissions", async () => {
    const folder = path.join(tmpHome, "merge-dir");
    const fs = await import("node:fs");
    fs.mkdirSync(path.join(folder, ".claude"), { recursive: true });
    fs.writeFileSync(
      path.join(folder, ".claude", "settings.local.json"),
      JSON.stringify({
        theme: "dark",
        permissions: { allow: ["Read"] },
      }),
    );

    const result = (await spawnHandler({
      folder,
      name: "merge",
    })) as { working_dir: string; pid: number };

    const settings = JSON.parse(
      fs.readFileSync(
        path.join(result.working_dir, ".claude", "settings.local.json"),
        "utf8",
      ),
    ) as { theme?: string; permissions?: { defaultMode?: string; allow?: string[] } };
    expect(settings.theme).toBe("dark");
    expect(settings.permissions?.allow).toEqual(["Read"]);
    expect(settings.permissions?.defaultMode).toBe("bypassPermissions");
    await gracefulKill(result.pid, 2000);
  });

  it("skips settings write when dangerously_skip_permissions is false", async () => {
    const folder = path.join(tmpHome, "no-bypass-dir");
    const result = (await spawnHandler({
      folder,
      name: "no-bypass",
      dangerously_skip_permissions: false,
    })) as { working_dir: string; pid: number };

    const settingsPath = path.join(result.working_dir, ".claude", "settings.local.json");
    expect(existsSync(settingsPath)).toBe(false);
    await gracefulKill(result.pid, 2000);
  });

  it("expands a leading `~` to the user's home directory", async () => {
    // We point HOME at a tmp dir so the test doesn't pollute the real home.
    const fakeHome = mkdtempSync(path.join(tmpdir(), "crm-home-"));
    const prevHome = process.env["HOME"];
    process.env["HOME"] = fakeHome;
    try {
      const result = (await spawnHandler({
        folder: "~/tilde-test",
        name: "tilde",
      })) as { working_dir: string; pid: number };
      expect(result.working_dir).toBe(path.join(fakeHome, "tilde-test"));
      expect(existsSync(result.working_dir)).toBe(true);
      await gracefulKill(result.pid, 2000);
    } finally {
      if (prevHome === undefined) delete process.env["HOME"];
      else process.env["HOME"] = prevHome;
      rmSync(fakeHome, { recursive: true, force: true });
    }
  });

  it("worktree mode silently ignores git_init (no .git inside the worktree folder)", async () => {
    // Make a tiny upstream repo so `git worktree add` has something to branch from.
    const upstream = path.join(tmpHome, "upstream");
    await runCommand("git", ["init", "-b", "main", upstream], {
      timeoutMs: 5000,
    });
    await runCommand(
      "git",
      ["commit", "--allow-empty", "-m", "root"],
      { cwd: upstream, timeoutMs: 5000 },
    );

    const prevProj = process.env["CLAUDE_PROJECT_DIR"];
    process.env["CLAUDE_PROJECT_DIR"] = upstream;
    try {
      const result = (await spawnHandler({
        folder: path.join(tmpHome, "wt-target"),
        spawn_mode: "worktree",
        name: "wt-test",
        git_init: true,
      })) as { working_dir: string; spawn_mode: string; pid: number };
      expect(result.spawn_mode).toBe("worktree");
      // The worktree has a `.git` *file* (not directory) pointing to the
      // parent repo. We just need to verify there was no error.
      expect(existsSync(result.working_dir)).toBe(true);
      await gracefulKill(result.pid, 2000);
    } finally {
      if (prevProj === undefined) delete process.env["CLAUDE_PROJECT_DIR"];
      else process.env["CLAUDE_PROJECT_DIR"] = prevProj;
    }
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
