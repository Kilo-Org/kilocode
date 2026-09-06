// kilocode_change - Write-surface adapter for the ActionGate (first slice, target/destination guarantee).
// Extends the reasoning-blind classifier from shell to the built-in write tools edit / write / apply_patch
// via the common built-in wrapper (session/tools.ts, before item.execute). The ActionEnvelope carries
// TARGETS ONLY (path + op) — never file content, to keep secrets out of the classifier prompt sent to the
// provider. NO deterministic write-tripwire in this slice; the existing
// per-tool permission ask is kept, the classifier judges target/op vs the user's intent on top of it.
// Enabled by KILO_WRITE_GATE=1; inert otherwise.
import { Effect } from "effect"
import path from "node:path"
import { Patch } from "@/patch"
import type { BlockCode, EditTarget, Verdict, WriteJudgeInput } from "./action-judge"

/** Opt-in, independent of KILO_ACTION_GATE / KILO_ACTION_CLASSIFIER. */
export const enabled = process.env["KILO_WRITE_GATE"] === "1"

/** Built-in write tools this slice gates (shell is gated in shell.ts; reads are not gated). */
export const WRITE_TOOLS = new Set(["edit", "write", "apply_patch"])
export type WriteToolId = "edit" | "write" | "apply_patch"

function abs(p: string, cwd: string): string {
  return path.isAbsolute(p) ? path.normalize(p) : path.resolve(cwd, p)
}

/**
 * Build the write targets from raw tool args. Pure given an `exists` predicate (injected — fs in prod,
 * fake in tests). Content/patch bodies are intentionally dropped: only paths and normalized ops reach
 * the envelope. Op normalization reflects the real effect:
 *   - edit: empty oldString -> create, else replace.
 *   - write: existing file -> overwrite, missing -> create.
 *   - apply_patch Add: existing target -> overwrite (Add clobbers), else create.
 *   - apply_patch Move: expanded into TWO targets — delete(source) + create|overwrite(destination) —
 *     so a destination overwrite is never hidden behind a single "move".
 * Throws on an unparseable patch so the caller can fail closed.
 *
 * NOTE (honest limitation): paths are lexical; a path lexically inside the workspace may point OUTSIDE
 * via a symlink — this slice does not resolve symlinks.
 */
export function buildTargets(
  tool: string,
  args: Record<string, unknown>,
  cwd: string,
  exists: (absPath: string) => boolean,
): EditTarget[] {
  // Only accept STRING argument values; a non-string (object/array) must not be coerced to "[object Object]".
  const str = (v: unknown): string => (typeof v === "string" ? v : "")
  if (tool === "edit") {
    const p = abs(str(args["filePath"]), cwd)
    return [{ path: p, op: str(args["oldString"]) === "" ? "create" : "replace" }]
  }
  if (tool === "write") {
    const p = abs(str(args["filePath"]), cwd)
    return [{ path: p, op: exists(p) ? "overwrite" : "create" }]
  }
  if (tool === "apply_patch") {
    const { hunks } = Patch.parsePatch(str(args["patchText"]))
    const out: EditTarget[] = []
    for (const h of hunks) {
      if (h.type === "add") {
        const p = abs(h.path, cwd)
        out.push({ path: p, op: exists(p) ? "overwrite" : "create" })
      } else if (h.type === "delete") {
        out.push({ path: abs(h.path, cwd), op: "delete" })
      } else if (h.move_path) {
        // rename: BOTH effects, atomically in the same target set
        out.push({ path: abs(h.path, cwd), op: "delete" })
        const d = abs(h.move_path, cwd)
        out.push({ path: d, op: exists(d) ? "overwrite" : "create" })
      } else {
        out.push({ path: abs(h.path, cwd), op: "replace" })
      }
    }
    return out
  }
  return []
}

const block = (reasonCode: BlockCode): Verdict => ({ decision: "block", reasonCode })

export interface WriteGateDeps {
  readonly tool: string
  readonly isChildSession: boolean
  readonly args: Record<string, unknown>
  readonly cwd: string
  readonly exists: (absPath: string) => boolean
  readonly intent: string | undefined
  /** Injected: production = ActionJudge.classify(...); tests pass a fake. */
  readonly judge: (input: WriteJudgeInput) => Effect.Effect<Verdict>
}

/**
 * Decide the write verdict WITHOUT executing. child-session / unparseable patch / missing intent all
 * short-circuit to a typed block BEFORE the judge is called (judge is NOT invoked). Every apply_patch
 * target is folded into ONE atomic judge decision before any side effect.
 */
export function decide(deps: WriteGateDeps): Effect.Effect<Verdict> {
  if (deps.isChildSession) return Effect.succeed(block("unverified_child_intent"))
  let targets: EditTarget[]
  try {
    targets = buildTargets(deps.tool, deps.args, deps.cwd, deps.exists)
  } catch {
    return Effect.succeed(block("patch_parse_error"))
  }
  if (!deps.intent) return Effect.succeed(block("intent_missing"))
  return deps.judge({ surface: "write", userIntent: deps.intent, cwd: deps.cwd, tool: deps.tool as WriteToolId, targets })
}
