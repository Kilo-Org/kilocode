/**
 * The checked-in mirror registry (`script/upstream/mirrors.json`).
 *
 * A mirror is a Kilo-owned copy of an upstream file. Upstream never edits Kilo-owned paths, so an
 * upstream change to the copied file merges cleanly at its own path and the copy drifts with no
 * conflict and no report line. Each entry records the upstream blob SHA last verified against the
 * pinned release and the intent of Kilo's differences.
 *
 * `script/check-mirrors.ts` fails when the pinned upstream file no longer has that SHA, when a copy
 * has no entry, or when an entry and its copy disagree about the upstream path. The fix is to
 * re-merge the upstream change into the copy with the intent in view, then record the new SHA.
 */

import { $ } from "bun"
import path from "node:path"

export interface MirrorEntry {
  /** Kilo-owned copy of the upstream file */
  mirror: string
  /** Upstream blob SHA at the last verified pinned release */
  sha: string
  /** The intent of Kilo's differences from the upstream file */
  changes: string
}

export interface Mirrors {
  mirrors: Record<string, MirrorEntry>
}

export interface MirrorState {
  upstream: string
  entry: MirrorEntry
  /** Upstream blob SHA at the pin, or null when the file no longer exists there */
  current: string | null
  exists: boolean
  /** Upstream path declared by the copy's `kilo_mirror:` marker */
  declared: string | null
}

export interface MarkedMirror {
  file: string
  upstream: string
}

export const REGISTRY = "script/upstream/mirrors.json"
export const MARKER = "kilo_mirror:"
const CODE = /\.(?:ts|tsx|js|mjs|cjs)$/
const MARKER_LINE = /^\s*\/\/\s*kilo_mirror:\s*(\S+)\s*$/
const HEAD = 4096

export async function readMirrors(root: string, file = REGISTRY): Promise<Mirrors> {
  const handle = Bun.file(path.resolve(root, file))
  if (!(await handle.exists())) return { mirrors: {} }
  return handle.json()
}

async function head(file: string): Promise<string> {
  return Bun.file(file).slice(0, HEAD).text()
}

/** The upstream path a copy declares, or null when it carries no marker. */
export function declared(text: string): string | null {
  return text
    .split("\n", 10)
    .map((line) => line.match(MARKER_LINE)?.[1])
    .find((value) => value !== undefined) ?? null
}

/** Upstream blob SHA, or null when the path does not exist at `ref`. */
export async function blob(ref: string, file: string): Promise<string | null> {
  const result = await $`git rev-parse ${`${ref}:${file}`}`.quiet().nothrow()
  return result.exitCode === 0 ? result.stdout.toString().trim() : null
}

/** Every code file under packages/kilo-* that declares a `kilo_mirror:` marker. */
export async function marked(root: string): Promise<MarkedMirror[]> {
  const files = (await $`git ls-files -co --exclude-standard -- packages/kilo-*`.cwd(root).quiet().text())
    .split("\n")
    .filter((file) => CODE.test(file))
  const found = await Promise.all(
    files.map(async (file) => {
      const handle = Bun.file(path.join(root, file))
      if (!(await handle.exists())) return null
      const upstream = declared(await head(path.join(root, file)))
      return upstream ? { file, upstream } : null
    }),
  )
  return found.filter((item): item is MarkedMirror => item !== null)
}

export async function inspect(root: string, pin: string, file = REGISTRY) {
  const registry = await readMirrors(root, file)
  const states = await Promise.all(
    Object.entries(registry.mirrors).map(async ([upstream, entry]): Promise<MirrorState> => {
      const handle = Bun.file(path.join(root, entry.mirror))
      const exists = await handle.exists()
      return {
        upstream,
        entry,
        current: await blob(pin, upstream),
        exists,
        declared: exists ? declared(await handle.slice(0, HEAD).text()) : null,
      }
    }),
  )
  return { states, marked: await marked(root) }
}

export function status(state: MirrorState): "ok" | "changed" | "removed" | "missing" | "unmarked" {
  if (state.current === null) return "removed"
  if (state.current !== state.entry.sha) return "changed"
  if (!state.exists) return "missing"
  if (state.declared !== state.upstream) return "unmarked"
  return "ok"
}

export function problems(states: MirrorState[], marked: MarkedMirror[]): string[] {
  const registered = new Map(states.map((state) => [state.upstream, state.entry.mirror]))
  return [
    ...states.flatMap((state) => {
      const errors: string[] = []
      if (state.current === null)
        errors.push(`${state.upstream} no longer exists at the pin. Remove ${state.entry.mirror} or update ${REGISTRY}`)
      else if (state.current !== state.entry.sha)
        errors.push(
          `${state.upstream} changed upstream (recorded ${state.entry.sha.slice(0, 11)}, pin has ${state.current.slice(0, 11)}). Re-merge it into ${state.entry.mirror} with this intent: ${state.entry.changes} Then record the new SHA in ${REGISTRY}`,
        )
      if (!state.exists) errors.push(`mirror is missing: ${state.entry.mirror}`)
      else if (state.declared !== state.upstream)
        errors.push(
          `${state.entry.mirror} must start with \`// ${MARKER} ${state.upstream}\` (found ${state.declared ?? "no marker"})`,
        )
      return errors
    }),
    ...marked
      .filter((item) => !registered.has(item.upstream))
      .map((item) => `unregistered mirror: ${item.file} declares ${item.upstream}. Add it to ${REGISTRY} with its SHA and intent`),
    ...marked.flatMap((item) => {
      const mirror = registered.get(item.upstream)
      if (!mirror || mirror === item.file) return []
      return [`${item.file} declares ${item.upstream}, which is registered to ${mirror}`]
    }),
  ]
}
