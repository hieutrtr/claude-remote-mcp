import { spawn } from "node:child_process";
import { afterAll, describe, expect, it } from "vitest";
import { gracefulKill, pidAlive } from "../../src/platform.js";

describe("platform.pidAlive", () => {
  it("returns true for current process", () => {
    expect(pidAlive(process.pid)).toBe(true);
  });

  it("returns false for invalid pid", () => {
    expect(pidAlive(-1)).toBe(false);
    expect(pidAlive(0)).toBe(false);
  });

  it("returns false for unused pid", () => {
    expect(pidAlive(99_999_999)).toBe(false);
  });
});

describe("platform.gracefulKill", () => {
  const pids: number[] = [];
  afterAll(() => {
    for (const pid of pids) {
      try { process.kill(pid, "SIGKILL"); } catch { /* noop */ }
    }
  });

  it("SIGTERMs a live process", async () => {
    const child = spawn("sleep", ["30"], { stdio: "ignore", detached: true });
    if (!child.pid) throw new Error("no pid");
    pids.push(child.pid);
    expect(pidAlive(child.pid)).toBe(true);
    const res = await gracefulKill(child.pid, 2000);
    expect(res.killed).toBe(true);
    expect(["SIGTERM", "SIGKILL"]).toContain(res.signal);
    expect(pidAlive(child.pid)).toBe(false);
  });

  it("returns {killed:false, signal:none} for dead pid", async () => {
    const res = await gracefulKill(99_999_998);
    expect(res.killed).toBe(false);
    expect(res.signal).toBe("none");
  });
});
