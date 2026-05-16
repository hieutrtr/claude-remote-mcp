import { defineConfig } from "vitest/config";

// Make git operations in tests independent of the host's git config. Some
// CI / sandbox environments enforce commit signing via a signing server that
// is not available inside the test runner. Set author identity + disable
// signing so `git commit` works deterministically across machines.
process.env["GIT_AUTHOR_NAME"] = process.env["GIT_AUTHOR_NAME"] ?? "crm-test";
process.env["GIT_AUTHOR_EMAIL"] = process.env["GIT_AUTHOR_EMAIL"] ?? "test@example.com";
process.env["GIT_COMMITTER_NAME"] = process.env["GIT_COMMITTER_NAME"] ?? "crm-test";
process.env["GIT_COMMITTER_EMAIL"] = process.env["GIT_COMMITTER_EMAIL"] ?? "test@example.com";
process.env["GIT_CONFIG_COUNT"] = "1";
process.env["GIT_CONFIG_KEY_0"] = "commit.gpgsign";
process.env["GIT_CONFIG_VALUE_0"] = "false";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    pool: "forks",
    poolOptions: {
      forks: { singleFork: false },
    },
  },
});
