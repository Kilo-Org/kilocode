import z from "zod"
import { MemoryOperations } from "./ops"
import digest from "../prompts/session-digest.txt"
import typed from "../prompts/typed-consolidation.txt"

export const typedPrompt = typed
export const digestPrompt = digest

const skip = z
  .enum([
    "duplicate",
    "transient",
    "unsupported",
    "secret",
    "too_specific",
    "in_progress",
    "policy_belongs_in_docs",
    "out_of_scope",
    "self_referential",
    "quota_guard",
    "rate_limit_guard",
  ])
  .catch("unsupported")

const key = z.string().trim().min(1).max(80)
const value = z.string().trim().min(1).max(2_000)
const addSchema = (
  op: "upsert_project_fact" | "upsert_project_decision" | "upsert_project_constraint" | "append_correction",
) => z.object({ op: z.literal(op), key, value }).strict()

export const typedSchema = z
  .object({
    operations: z
      .array(
        z.discriminatedUnion("op", [
          addSchema("upsert_project_fact"),
          addSchema("upsert_project_decision"),
          addSchema("upsert_project_constraint"),
          addSchema("append_correction"),
          z
            .object({
              op: z.literal("upsert_environment_fact"),
              key,
              value,
              section: z.enum(["Commands", "Paths", "Tooling", "commands", "paths", "tooling"]),
            })
            .strict(),
          z.object({ op: z.literal("remove_memory"), query: z.string().trim().min(1).max(240) }).strict(),
          z
            .object({
              op: z.literal("noop"),
              key: z.string().max(80).optional(),
              value: z.string().max(2_000).optional(),
            })
            .strict(),
        ]),
      )
      .max(16),
    skipped: z
      .array(
        z
          .object({
            reason: skip,
            text: z.string().max(500).optional(),
            duplicateOf: z.string().max(240).optional(),
          })
          .strict(),
      )
      .max(32)
      .default([]),
  })
  .strict()

export const digestSchema = z
  .object({
    topic: z.string().max(160).default(""),
    summary: z.string().max(4_000).default(""),
  })
  .strict()

export type CaptureSkip = z.infer<typeof typedSchema>["skipped"][number]
export type CaptureDigest = z.infer<typeof digestSchema>

function clean(input: string) {
  return input
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim()
}

export function parseJson<T>(schema: z.ZodType<T>, input: string) {
  if (Buffer.byteLength(input) > 64_000) throw new Error("memory model output exceeds 64000 bytes")
  return schema.parse(JSON.parse(clean(input)))
}

function add(op: { key: string; value: string }, file: MemoryOperations.Add["file"], section?: string) {
  const key = op.key.trim()
  const body = op.value.trim()
  if (!key || !body) return []
  return [{ action: "add", file, section, key, text: body }] satisfies MemoryOperations.Op[]
}

function env(input: string | undefined) {
  const text = input?.trim().toLowerCase()
  if (text === "paths" || text === "path") return "Paths"
  if (text === "tooling" || text === "tools" || text === "tool") return "Tooling"
  return "Commands"
}

export function parseOps(input: z.infer<typeof typedSchema>): MemoryOperations.Op[] {
  return input.operations.flatMap((op): MemoryOperations.Op[] => {
    if (op.op === "remove_memory") return [{ action: "remove", query: op.query.trim() }]
    if (op.op === "append_correction") return add(op, "corrections.md", "Corrections")
    if (op.op === "upsert_project_decision") return add(op, "project.md", "Decisions")
    if (op.op === "upsert_project_constraint") return add(op, "project.md", "Constraints")
    if (op.op === "upsert_project_fact") return add(op, "project.md", "Facts")
    if (op.op === "upsert_environment_fact") return add(op, "environment.md", env(op.section))
    return []
  })
}

export function mergeOps(ops: MemoryOperations.Op[]) {
  const result: MemoryOperations.Op[] = []
  for (const item of ops) {
    if (item.action === "remove") {
      if (!result.some((prior) => prior.action === "remove" && prior.query === item.query)) result.push(item)
      continue
    }
    if (
      !result.some(
        (prior) =>
          prior.action === "add" &&
          prior.file === item.file &&
          prior.section === item.section &&
          prior.key === item.key,
      )
    ) {
      result.push(item)
    }
  }
  return result
}
