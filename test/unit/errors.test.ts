import { describe, expect, it } from "vitest";
import { CrmError, ErrorCodes, isCrmError } from "../../src/errors.js";

describe("errors", () => {
  it("CrmError exposes code/details/remediation", () => {
    const err = new CrmError(ErrorCodes.WORKSPACE_NOT_TRUSTED, "boom", {
      details: { folder: "/x" },
      remediation: "run claude",
    });
    expect(err.code).toBe("WORKSPACE_NOT_TRUSTED");
    expect(err.toJSON()).toMatchObject({
      code: "WORKSPACE_NOT_TRUSTED",
      message: "boom",
      details: { folder: "/x" },
      remediation: "run claude",
    });
  });

  it("isCrmError discriminates", () => {
    expect(isCrmError(new CrmError(ErrorCodes.INVALID_INPUT, "x"))).toBe(true);
    expect(isCrmError(new Error("x"))).toBe(false);
    expect(isCrmError(null)).toBe(false);
  });

  it("ErrorCodes are exhaustive enum strings", () => {
    expect(ErrorCodes.CLAUDE_NOT_FOUND).toBe("CLAUDE_NOT_FOUND");
    expect(Object.keys(ErrorCodes).length).toBeGreaterThan(10);
  });
});
