import { closeSync, openSync, readSync } from "node:fs";
import { CrmError, ErrorCodes } from "./errors.js";

const DEFAULT_REGEX = /https:\/\/claude\.ai\/code\/\S+/;

export interface TailResult {
  url: string;
  matchedAt: number;
  bytesRead: number;
}

export async function tailForUrl(
  logFile: string,
  opts: { timeoutMs?: number; pollMs?: number; regex?: RegExp } = {},
): Promise<TailResult> {
  const envTimeout = process.env["CLAUDE_REMOTE_MCP_URL_TIMEOUT_MS"];
  const timeoutMs =
    opts.timeoutMs ??
    (envTimeout && envTimeout.length > 0 && Number.isFinite(Number(envTimeout))
      ? Math.max(0, Number(envTimeout))
      : 30_000);
  const pollMs = opts.pollMs ?? 250;
  const regexEnv = process.env["CLAUDE_REMOTE_MCP_URL_REGEX"];
  const regex = opts.regex ?? (regexEnv ? new RegExp(regexEnv) : DEFAULT_REGEX);

  const start = Date.now();
  let buf = "";

  while (Date.now() - start < timeoutMs) {
    try {
      const content = readWholeFile(logFile);
      buf = content;
      const m = buf.match(regex);
      if (m && m[0]) {
        return {
          url: m[0],
          matchedAt: Date.now() - start,
          bytesRead: buf.length,
        };
      }
    } catch {
      // file might not exist yet
    }
    await sleep(pollMs);
  }

  throw new CrmError(
    ErrorCodes.URL_TIMEOUT,
    `Timed out after ${timeoutMs}ms waiting for Remote Control URL in ${logFile}`,
    { details: { logFile, bytesRead: buf.length, tail: buf.slice(-500) } },
  );
}

function readWholeFile(p: string): string {
  const fd = openSync(p, "r");
  try {
    const chunks: Buffer[] = [];
    const chunk = Buffer.alloc(64 * 1024);
    let bytesRead = 0;
    while ((bytesRead = readSync(fd, chunk, 0, chunk.length, null)) > 0) {
      chunks.push(Buffer.from(chunk.subarray(0, bytesRead)));
    }
    return Buffer.concat(chunks).toString("utf8");
  } finally {
    closeSync(fd);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
