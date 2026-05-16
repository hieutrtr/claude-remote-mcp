import { z } from "zod";

export const SpawnModeSchema = z.enum(["same-dir", "worktree", "session"]);
export type SpawnMode = z.infer<typeof SpawnModeSchema>;

export const SessionStatusSchema = z.enum(["alive", "stopped", "dead"]);
export type SessionStatus = z.infer<typeof SessionStatusSchema>;

export const SessionEntrySchema = z.object({
  session_id: z.string(),
  name: z.string(),
  url: z.string(),
  qr_ascii: z.string().default(""),
  pid: z.number().int(),
  working_dir: z.string(),
  spawn_mode: SpawnModeSchema,
  worktree_branch: z.string().nullable().default(null),
  sandbox: z.boolean().default(false),
  tags: z.array(z.string()).default([]),
  owner_orchestrator_pid: z.number().int(),
  owner_hostname: z.string(),
  started_at: z.string(),
  stopped_at: z.string().nullable().default(null),
  died_at: z.string().nullable().default(null),
  status: SessionStatusSchema,
});
export type SessionEntry = z.infer<typeof SessionEntrySchema>;

export const StateFileSchema = z.object({
  schema_version: z.literal(1),
  sessions: z.array(SessionEntrySchema),
});
export type StateFile = z.infer<typeof StateFileSchema>;

export const SpawnInputSchema = z.object({
  folder: z.string().min(1),
  name: z.string().optional(),
  spawn_mode: SpawnModeSchema.default("same-dir"),
  worktree_branch: z.string().optional(),
  sandbox: z.boolean().optional(),
  initial_prompt: z.string().optional(),
  tags: z.array(z.string()).default([]),
});
export type SpawnInput = z.infer<typeof SpawnInputSchema>;

export const ListInputSchema = z.object({
  filter_tags: z.array(z.string()).optional(),
  only_alive: z.boolean().default(true),
  include_other_hosts: z.boolean().default(false),
});
export type ListInput = z.infer<typeof ListInputSchema>;

export const StopInputSchema = z
  .object({
    session_id: z.string().optional(),
    pid: z.number().int().optional(),
  })
  .refine((d) => d.session_id !== undefined || d.pid !== undefined, {
    message: "cần session_id hoặc pid",
  });
export type StopInput = z.infer<typeof StopInputSchema>;

export const GetLinkInputSchema = z.object({
  session_id: z.string(),
});
export type GetLinkInput = z.infer<typeof GetLinkInputSchema>;

export const InstallPluginInputSchema = z.object({
  plugin: z.string().min(1),
  scope: z.enum(["user", "project", "local"]).default("project"),
  marketplace: z.string().url().optional(),
});
export type InstallPluginInput = z.infer<typeof InstallPluginInputSchema>;

export const InstallMcpServerInputSchema = z.object({
  name: z.string().min(1),
  command: z.string().min(1),
  args: z.array(z.string()).default([]),
  env: z.record(z.string(), z.string()).optional(),
  scope: z.enum(["user", "project", "local"]).default("project"),
});
export type InstallMcpServerInput = z.infer<typeof InstallMcpServerInputSchema>;

export const MergeBackInputSchema = z.object({
  session_id: z.string(),
  target_branch: z.string().min(1),
  strategy: z.enum(["merge", "rebase", "squash"]).default("rebase"),
  remove_worktree: z.boolean().default(true),
});
export type MergeBackInput = z.infer<typeof MergeBackInputSchema>;

export const PreflightCheckSchema = z.object({
  ok: z.boolean(),
  value: z.unknown().optional(),
  reason: z.string().optional(),
  required: z.string().optional(),
  path: z.string().optional(),
  folder: z.string().optional(),
  method: z.string().optional(),
  platform: z.string().optional(),
});
export type PreflightCheck = z.infer<typeof PreflightCheckSchema>;

export const PreflightResultSchema = z.object({
  ok: z.boolean(),
  checks: z.record(z.string(), PreflightCheckSchema),
  blocking: z.array(z.string()),
});
export type PreflightResult = z.infer<typeof PreflightResultSchema>;
