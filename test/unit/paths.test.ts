import { describe, expect, it } from "vitest";
import { auditLogPath, childLogPath, dataHome, stateFilePath } from "../../src/paths.js";

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
});
