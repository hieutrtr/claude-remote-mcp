import { mkdtempSync, rmSync, writeFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { tailForUrl } from "../../src/urlTail.js";

describe("tailForUrl", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(path.join(tmpdir(), "crm-tail-"));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("matches URL already in file", async () => {
    const f = path.join(tmp, "log.txt");
    writeFileSync(f, "Starting Claude Code...\nOpen: https://claude.ai/code/abc123\nReady");
    const res = await tailForUrl(f, { timeoutMs: 2000, pollMs: 50 });
    expect(res.url).toBe("https://claude.ai/code/abc123");
  });

  it("matches URL written after a delay", async () => {
    const f = path.join(tmp, "log.txt");
    writeFileSync(f, "boot...\n");
    const promise = tailForUrl(f, { timeoutMs: 5000, pollMs: 50 });
    setTimeout(() => {
      appendFileSync(f, "Open https://claude.ai/code/xyz456 to connect\n");
    }, 200);
    const res = await promise;
    expect(res.url).toBe("https://claude.ai/code/xyz456");
  });

  it("throws URL_TIMEOUT when no match", async () => {
    const f = path.join(tmp, "log.txt");
    writeFileSync(f, "nothing here");
    await expect(
      tailForUrl(f, { timeoutMs: 300, pollMs: 50 }),
    ).rejects.toMatchObject({ code: "URL_TIMEOUT" });
  });

  it("respects custom regex", async () => {
    const f = path.join(tmp, "log.txt");
    writeFileSync(f, "weird format: SESSION=foo-bar-baz READY");
    const res = await tailForUrl(f, {
      timeoutMs: 1000,
      pollMs: 50,
      regex: /SESSION=([a-z-]+)/,
    });
    expect(res.url).toMatch(/SESSION=foo-bar-baz/);
  });
});
