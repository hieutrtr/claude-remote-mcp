import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { CrmError, ErrorCodes } from "./errors.js";

let cachedClaudePath: string | undefined;

export function resolveClaudeBin(): string {
  const override = process.env["CLAUDE_BIN"];
  if (override && existsSync(override)) {
    return override;
  }
  if (cachedClaudePath !== undefined) return cachedClaudePath;

  const home = process.env["HOME"] ?? "";
  const candidates = [
    "/opt/node22/bin/claude",
    "/usr/local/bin/claude",
    "/usr/bin/claude",
    path.join(home, ".local", "bin", "claude"),
    path.join(home, ".claude", "local", "claude"),
  ];
  for (const c of candidates) {
    if (existsSync(c)) {
      cachedClaudePath = c;
      return c;
    }
  }

  const pathEnv = process.env["PATH"] ?? "";
  const sep = process.platform === "win32" ? ";" : ":";
  for (const dir of pathEnv.split(sep)) {
    const candidate = path.join(
      dir,
      process.platform === "win32" ? "claude.exe" : "claude",
    );
    if (existsSync(candidate)) {
      cachedClaudePath = candidate;
      return candidate;
    }
  }

  throw new CrmError(
    ErrorCodes.CLAUDE_NOT_FOUND,
    "Cannot locate the `claude` CLI binary. Install Claude Code or set CLAUDE_BIN env var.",
    { remediation: "Install from https://docs.claude.com/en/docs/claude-code" },
  );
}

export interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export function runClaude(args: string[], opts: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number } = {}): Promise<RunResult> {
  return runCommand(resolveClaudeBin(), args, opts);
}

export function runCommand(
  cmd: string,
  args: string[],
  opts: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number } = {},
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: opts.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    const timeoutMs = opts.timeoutMs ?? 30_000;
    const t = setTimeout(() => {
      child.kill("SIGKILL");
      reject(
        new Error(`Command timed out after ${timeoutMs}ms: ${cmd} ${args.join(" ")}`),
      );
    }, timeoutMs);

    child.on("error", (err) => {
      clearTimeout(t);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(t);
      resolve({ exitCode: code ?? 0, stdout, stderr });
    });
  });
}

export async function claudeVersion(): Promise<string> {
  const { stdout } = await runClaude(["--version"], { timeoutMs: 10_000 });
  const m = stdout.match(/(\d+\.\d+\.\d+)/);
  if (!m || !m[1]) {
    throw new CrmError(
      ErrorCodes.CLAUDE_NOT_FOUND,
      `Unable to parse version from \`claude --version\` output: ${stdout.trim()}`,
    );
  }
  return m[1];
}

export interface PluginInstallOpts {
  plugin: string;
  scope: "user" | "project" | "local";
  marketplace?: string | undefined;
  cwd?: string;
}

export async function claudePluginInstall(
  opts: PluginInstallOpts,
): Promise<{ stdout: string; version: string | null }> {
  const args = ["plugin", "install", opts.plugin];
  if (opts.scope !== "project") args.push("--scope", opts.scope);
  if (opts.marketplace) args.push("--marketplace", opts.marketplace);
  const res = await runClaude(args, { cwd: opts.cwd, timeoutMs: 120_000 });
  if (res.exitCode !== 0) {
    throw new CrmError(
      ErrorCodes.PLUGIN_INSTALL_FAILED,
      `claude plugin install exited ${res.exitCode}`,
      { details: { stdout: res.stdout, stderr: res.stderr } },
    );
  }
  const m = res.stdout.match(/version[:\s]+v?(\d+\.\d+\.\d+)/i);
  return { stdout: res.stdout, version: m && m[1] ? m[1] : null };
}

export interface McpAddOpts {
  name: string;
  command: string;
  args: string[];
  env?: Record<string, string> | undefined;
  scope: "user" | "project" | "local";
  cwd?: string;
}

export async function claudeMcpAdd(opts: McpAddOpts): Promise<{ stdout: string }> {
  const argv = ["mcp", "add", opts.name];
  if (opts.scope !== "project") argv.push("--scope", opts.scope);
  if (opts.env) {
    for (const [k, v] of Object.entries(opts.env)) {
      argv.push("--env", `${k}=${v}`);
    }
  }
  argv.push("--", opts.command, ...opts.args);
  const res = await runClaude(argv, { cwd: opts.cwd, timeoutMs: 60_000 });
  if (res.exitCode !== 0) {
    throw new CrmError(
      ErrorCodes.MCP_ADD_FAILED,
      `claude mcp add exited ${res.exitCode}`,
      { details: { stdout: res.stdout, stderr: res.stderr } },
    );
  }
  return { stdout: res.stdout };
}
