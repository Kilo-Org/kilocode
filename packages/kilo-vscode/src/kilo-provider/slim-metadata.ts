/**
 * Pure data-transform helpers that strip heavy tool metadata from
 * message parts before sending them to the webview via postMessage.
 *
 * The webview communicates with the extension over VS Code's IPC bridge.
 * Every message is JSON-serialised → deserialised on each side.  Tool parts
 * from edit, apply_patch, multiedit and write often carry full file contents
 * (before/after snapshots, patch text, written content).  Sending those on
 * every session switch makes serialisation the dominant bottleneck.
 *
 * This module strips fields the webview never (or rarely) needs while keeping
 * everything required to render collapsed tool-part headers and diagnostics.
 *
 * No vscode dependency — safe to unit-test in isolation.
 */

// Max chars to keep for truncated output fields (bash metadata.output etc.)
const OUTPUT_CAP = 4000

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v)
}

/** Truncate a string value to cap, appending a marker when trimmed. */
function cap(v: unknown, limit = OUTPUT_CAP): string | undefined {
  if (typeof v !== "string") return undefined
  if (v.length <= limit) return v
  return v.slice(0, limit) + `\n… (truncated, ${v.length - limit} chars omitted)`
}

// ---------------------------------------------------------------------------
// Per-tool slimmers
// ---------------------------------------------------------------------------

/** edit: strip filediff.before/after (webview falls back to input.oldString/newString). */
function slimEdit(state: Record<string, unknown>): Record<string, unknown> {
  const next = { ...state }
  const meta = state.metadata
  if (!isObj(meta)) {
    delete next.metadata
    return next
  }

  const result: Record<string, unknown> = {}
  const fd = meta.filediff
  if (isObj(fd)) {
    result.filediff = {
      ...(typeof fd.file === "string" ? { file: fd.file } : {}),
      additions: typeof fd.additions === "number" ? fd.additions : 0,
      deletions: typeof fd.deletions === "number" ? fd.deletions : 0,
    }
  }
  if (meta.diagnostics) result.diagnostics = meta.diagnostics
  next.metadata = result
  return next
}

/** apply_patch: strip files[].before/after/diff, metadata.diff, + input.patchText. */
function slimPatch(state: Record<string, unknown>): Record<string, unknown> {
  const next = { ...state }
  const meta = state.metadata
  if (isObj(meta)) {
    const slim: Record<string, unknown> = {}
    if (meta.diagnostics) slim.diagnostics = meta.diagnostics
    if (Array.isArray(meta.files)) {
      slim.files = (meta.files as Record<string, unknown>[]).map((f) => ({
        filePath: f.filePath,
        relativePath: f.relativePath,
        type: f.type,
        additions: f.additions,
        deletions: f.deletions,
        movePath: f.movePath,
      }))
    }
    next.metadata = slim
  }
  // Strip the full patch text from input — only keep files count for title
  const input = state.input
  if (isObj(input) && typeof input.patchText === "string") {
    next.input = { ...input, patchText: undefined }
  }
  return next
}

/** multiedit: strip nested results (each is a full edit metadata object) and top-level diff. */
function slimMultiedit(state: Record<string, unknown>): Record<string, unknown> {
  const next = { ...state }
  const meta = state.metadata
  if (isObj(meta)) {
    const slim: Record<string, unknown> = {}
    if (meta.diagnostics) slim.diagnostics = meta.diagnostics
    if (Array.isArray(meta.results)) {
      slim.results = (meta.results as Record<string, unknown>[]).map((r) => {
        const rs: Record<string, unknown> = {}
        if (r.diagnostics) rs.diagnostics = r.diagnostics
        const fd = r.filediff
        if (isObj(fd)) {
          rs.filediff = {
            ...(typeof fd.file === "string" ? { file: fd.file } : {}),
            additions: typeof fd.additions === "number" ? fd.additions : 0,
            deletions: typeof fd.deletions === "number" ? fd.deletions : 0,
          }
        }
        return rs
      })
    }
    next.metadata = slim
  }
  return next
}

/** write: strip input.content, raw diff text, and filediff.before/after. Keep filepath + exists + diagnostics. */
function slimWrite(state: Record<string, unknown>): Record<string, unknown> {
  const next = { ...state }
  const input = state.input
  if (isObj(input) && typeof input.content === "string") {
    next.input = { ...input, content: undefined }
  }
  const meta = state.metadata
  if (isObj(meta)) {
    const slim: Record<string, unknown> = {}
    if (meta.filepath) slim.filepath = meta.filepath
    if (meta.exists !== undefined) slim.exists = meta.exists
    if (meta.diagnostics) slim.diagnostics = meta.diagnostics
    const fd = meta.filediff
    if (isObj(fd)) {
      slim.filediff = {
        ...(typeof fd.file === "string" ? { file: fd.file } : {}),
        additions: typeof fd.additions === "number" ? fd.additions : 0,
        deletions: typeof fd.deletions === "number" ? fd.deletions : 0,
      }
    }
    next.metadata = slim
  }
  return next
}

/** read/list/search: keep the rendered tool details lightweight on historical loads. */
function slimOutput(state: Record<string, unknown>): Record<string, unknown> {
  const next = { ...state }
  if (typeof state.output === "string" && state.output.length > OUTPUT_CAP) {
    next.output = cap(state.output)
  }
  return next
}

/** bash: truncate metadata.output and state.output. */
function slimBash(state: Record<string, unknown>): Record<string, unknown> {
  const next = slimOutput(state)
  const meta = state.metadata
  if (isObj(meta) && typeof meta.output === "string" && meta.output.length > OUTPUT_CAP) {
    next.metadata = { ...meta, output: cap(meta.output) }
  }
  return next
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

const slimmers: Record<string, (state: Record<string, unknown>) => Record<string, unknown>> = {
  read: slimOutput,
  list: slimOutput,
  glob: slimOutput,
  grep: slimOutput,
  edit: slimEdit,
  apply_patch: slimPatch,
  multiedit: slimMultiedit,
  write: slimWrite,
  bash: slimBash,
}

/** Strip heavy metadata from a single tool part; pass-through for non-tool parts. */
export function slimPart<T>(part: T): T {
  if (!part || typeof part !== "object") return part

  const obj = part as Record<string, unknown>
  if (obj.type !== "tool") return part

  const tool = obj.tool
  if (typeof tool !== "string") return part

  const fn = slimmers[tool]
  if (!fn) return part

  const state = obj.state
  if (!isObj(state)) return part

  return { ...obj, state: fn(state) } as T
}

/** Slim every part in an array. */
export function slimParts<T>(parts: T[]): T[] {
  return parts.map((part) => slimPart(part))
}
