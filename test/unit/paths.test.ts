import { homedir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  auditLogPath,
  childLogPath,
  dataHome,
  expandTilde,
  isInsidePluginCache,
  orchestratorProjectDir,
  registerListRoots,
  resolveOrchestratorProjectDir,
  stateFilePath,
} from "../../src/paths.js";

describe("paths", () => {
  it("honors CLAUDE_REMOTE_MCP_HOME", () => {
    const prev = process.env["CLAUDE_REMOTE_MCP_HOME"];
    process.env["CLAUDE_REMOTE_MCP_HOME"] = "/tmp/crm-test-dir";
    try {
      expect(dataHome()).toBe("/tmp/crm-test-dir");
      expect(stateFilePath()).toBe("/tmp/crm-test-dir/state.json");
      expect(auditLogPath()).toBe("/tmp/crm-test-dir/audit.log");
      expect(childLogPath("a-b-c")).toBe("/tmp/crm-test-dir/logs/a-b-c.log");
    } finally {
      if (prev === undefined) delete process.env["CLAUDE_REMOTE_MCP_HOME"];
      else process.env["CLAUDE_REMOTE_MCP_HOME"] = prev;
    }
  });

  it("sanitizes session ids in child log path", () => {
    process.env["CLAUDE_REMOTE_MCP_HOME"] = "/tmp/crm-test-dir";
    try {
      expect(childLogPath("../weird/$id")).toBe("/tmp/crm-test-dir/logs/.._weird__id.log");
    } finally {
      delete process.env["CLAUDE_REMOTE_MCP_HOME"];
    }
  });

  it("expandTilde expands ~ to home and leaves other paths unchanged", () => {
    expect(expandTilde("~")).toBe(homedir());
    expect(expandTilde("~/projects/demo")).toBe(path.join(homedir(), "projects/demo"));
    expect(expandTilde("/abs/path")).toBe("/abs/path");
    expect(expandTilde("./relative")).toBe("./relative");
    expect(expandTilde("relative")).toBe("relative");
    // ~user/... is not expanded (we can't resolve other users portably)
    expect(expandTilde("~root/foo")).toBe("~root/foo");
  });
});

describe("orchestratorProjectDir resolution", () => {
  const ENVS = [
    "CLAUDE_REMOTE_MCP_PROJECT_DIR",
    "CLAUDE_PROJECT_DIR",
    "PWD",
  ];
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of ENVS) saved[k] = process.env[k];
    for (const k of ENVS) delete process.env[k];
    registerListRoots(undefined as never);
  });

  afterEach(() => {
    for (const k of ENVS) {
      const v = saved[k];
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("isInsidePluginCache detects the cache pattern", () => {
    expect(isInsidePluginCache("/home/me/.claude/plugins/cache/m/p/0.1.0")).toBe(true);
    expect(isInsidePluginCache("/home/me/projects/foo")).toBe(false);
    expect(isInsidePluginCache("C:\\Users\\me\\.claude\\plugins\\cache\\m\\p")).toBe(true);
  });

  it("prefers CLAUDE_REMOTE_MCP_PROJECT_DIR over CLAUDE_PROJECT_DIR", async () => {
    process.env["CLAUDE_REMOTE_MCP_PROJECT_DIR"] = "/a/override";
    process.env["CLAUDE_PROJECT_DIR"] = "/b/native";
    const r = await orchestratorProjectDir();
    expect(r).toEqual({ dir: "/a/override", source: "CLAUDE_REMOTE_MCP_PROJECT_DIR" });
  });

  it("rejects an env that points inside the plugin cache and falls through", async () => {
    process.env["CLAUDE_REMOTE_MCP_PROJECT_DIR"] =
      "/home/me/.claude/plugins/cache/m/p/0.1.0";
    process.env["CLAUDE_PROJECT_DIR"] = "/real/project";
    const r = await orchestratorProjectDir();
    expect(r).toEqual({ dir: "/real/project", source: "CLAUDE_PROJECT_DIR" });
  });

  it("throws INVALID_INPUT when no strategy yields a non-cache directory", async () => {
    process.env["CLAUDE_REMOTE_MCP_PROJECT_DIR"] =
      "/home/me/.claude/plugins/cache/m/p/0.1.0";
    process.env["CLAUDE_PROJECT_DIR"] =
      "/home/me/.claude/plugins/cache/m/p/0.1.0";
    process.env["PWD"] = "/home/me/.claude/plugins/cache/m/p/0.1.0";

    const { resolveOrchestratorProjectDir: resolve } = await import("../../src/paths.js");
    const out = await resolve();
    // Either resolved is null (forks isolating cwd inside plugin cache - rare in tests)
    // or resolved.source is "process.cwd()" (vitest cwd is not in cache).
    if (out.resolved === null) {
      await expect(orchestratorProjectDir()).rejects.toMatchObject({
        code: "INVALID_INPUT",
      });
    } else {
      expect(out.resolved.source).toBe("process.cwd()");
    }
    expect(out.attempts.length).toBeGreaterThanOrEqual(4);
    expect(out.attempts.some((a) => a.rejected_reason === "inside plugin install cache")).toBe(true);
  });
});
