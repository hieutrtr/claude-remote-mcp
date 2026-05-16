import { spawn, type ChildProcess } from "node:child_process";

export interface SpawnDetachedOpts {
  cwd: string;
  logFd: number;
  env?: NodeJS.ProcessEnv;
}

export function spawnDetached(
  cmd: string,
  args: string[],
  opts: SpawnDetachedOpts,
): ChildProcess {
  const child = spawn(cmd, args, {
    cwd: opts.cwd,
    stdio: ["ignore", opts.logFd, opts.logFd],
    detached: true,
    windowsHide: true,
    env: opts.env ?? process.env,
  });
  child.unref();
  return child;
}

export function pidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === "ESRCH") return false;
    if (e.code === "EPERM") return true;
    throw err;
  }
}

export async function gracefulKill(
  pid: number,
  timeoutMs = 5000,
  pollMs = 250,
): Promise<{ killed: boolean; signal: "SIGTERM" | "SIGKILL" | "none" }> {
  if (!pidAlive(pid)) return { killed: false, signal: "none" };

  try {
    process.kill(pid, "SIGTERM");
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === "ESRCH") return { killed: false, signal: "none" };
    throw err;
  }

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!pidAlive(pid)) return { killed: true, signal: "SIGTERM" };
    await sleep(pollMs);
  }

  try {
    process.kill(pid, "SIGKILL");
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === "ESRCH") return { killed: true, signal: "SIGTERM" };
    throw err;
  }

  await sleep(pollMs);
  return { killed: !pidAlive(pid), signal: "SIGKILL" };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
