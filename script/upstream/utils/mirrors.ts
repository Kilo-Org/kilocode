/**
 * The checked-in mirror registry (`script/upstream/mirrors.json`).
 *
 * A mirror is a Kilo-owned copy of an upstream file. Upstream never edits Kilo-owned paths, so an
 * upstream change to the copied file merges cleanly at its own path and the copy drifts with no
 * conflict and no report line. Each entry records the upstream blob SHA last verified against the
 * pinned release, why Kilo copies the file instead of using an upstream extension point, and the
 * invariants a re-merge must keep.
 *
 * The registry has two kinds of problem, and they belong to different people:
 * - Structure: a copy without an entry, an entry whose copy is missing, a marker naming another
 *   path. The PR that adds the copy fixes it, so this is checked on every PR and needs no pin.
 * - Drift: the pinned upstream file no longer has the recorded SHA. Only an upstream sync can take
 *   that change, re-merge it into the copy and record the new SHA, so the sync checks it and does
 *   not finish while a copy is behind (`script/check-mirrors.ts --drift`).
 */

import { $ } from "bun"
import path from "node:path"

export interface MirrorEntry {
  /** Kilo-owned copy of the upstream file */
  mirror: string
  /** Upstream blob SHA at the last verified pinned release */
  sha: string
  /** Why Kilo copies the file instead of using an upstream extension point */
  why: string
  /** Rules a re-merge must keep: what Kilo's copy adds on top of upstream */
  invariants: string[]
}

export interface Mirrors {
  mirrors: Record<string, MirrorEntry>
}

export interface MirrorState {
  upstream: string
  entry: MirrorEntry
  /** Upstream blob SHA at the pin, null when the file no longer exists there, undefined when no pin was checked */
  current?: string | null
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

/**
 * Read the registry and the copies. Blob lookups happen only with a pin, so the structure check needs
 * none. Incomplete entries are left to `malformed`, which reports them.
 */
export async function inspect(root: string, file = REGISTRY, pin?: string) {
  const registry = await readMirrors(root, file)
  const states = await Promise.all(
    Object.entries(registry.mirrors)
      .filter(
        ([, entry]) =>
          typeof entry.mirror === "string" &&
          typeof entry.sha === "string" &&
          typeof entry.why === "string" &&
          Array.isArray(entry.invariants),
      )
      .map(async ([upstream, entry]): Promise<MirrorState> => {
        const handle = Bun.file(path.join(root, entry.mirror))
        const exists = await handle.exists()
        return {
          upstream,
          entry,
          current: pin ? await blob(pin, upstream) : undefined,
          exists,
          declared: exists ? declared(await handle.slice(0, HEAD).text()) : null,
        }
      }),
  )
  return { registry, states, marked: await marked(root) }
}

export function status(state: MirrorState): "ok" | "changed" | "removed" | "missing" | "unmarked" {
  if (state.current === null) return "removed"
  if (state.current !== undefined && state.current !== state.entry.sha) return "changed"
  if (!state.exists) return "missing"
  if (state.declared !== state.upstream) return "unmarked"
  return "ok"
}

/**
 * Entries that cannot guide a re-merge: a missing path or SHA, an empty `why`, or no invariant. The
 * prose is the point of the entry, so an empty one leaves the next sync with nothing to re-merge by.
 */
export function malformed(registry: Mirrors, file = REGISTRY): string[] {
  return Object.entries(registry.mirrors).flatMap(([upstream, entry]) => {
    const rules = Array.isArray(entry.invariants) ? entry.invariants : []
    return [
      ...(typeof entry.mirror === "string" && entry.mirror !== ""
        ? []
        : [`${upstream}: missing \`mirror\` in ${file}`]),
      ...(typeof entry.sha === "string" && entry.sha !== "" ? [] : [`${upstream}: missing \`sha\` in ${file}`]),
      ...(typeof entry.why === "string" && entry.why.trim() !== ""
        ? []
        : [`${upstream}: \`why\` is empty in ${file}. Say why Kilo copies the file instead of using an upstream extension point`]),
      ...(rules.length > 0 && rules.every((rule) => typeof rule === "string" && rule.trim() !== "")
        ? []
        : [`${upstream}: \`invariants\` needs at least one non-empty rule a re-merge must keep, in ${file}`]),
    ]
  })
}

/** Problems the PR that adds or edits a copy can fix without knowing the pin. */
export function problems(states: MirrorState[], marked: MarkedMirror[], file = REGISTRY): string[] {
  const registered = new Map(states.map((state) => [state.upstream, state.entry.mirror]))
  return [
    ...states.flatMap((state) => {
      if (!state.exists) return [`mirror is missing: ${state.entry.mirror}`]
      if (state.declared !== state.upstream)
        return [
          `${state.entry.mirror} must start with \`// ${MARKER} ${state.upstream}\` (found ${state.declared ?? "no marker"})`,
        ]
      return []
    }),
    ...marked
      .filter((item) => !registered.has(item.upstream))
      .map(
        (item) =>
          `unregistered mirror: ${item.file} declares ${item.upstream}. Add it to ${file} with its SHA, why and invariants`,
      ),
    ...marked.flatMap((item) => {
      const mirror = registered.get(item.upstream)
      if (!mirror || mirror === item.file) return []
      return [`${item.file} declares ${item.upstream}, which is registered to ${mirror}`]
    }),
  ]
}

/** Copies whose upstream file changed or disappeared since the recorded SHA. Needs a pin. */
export function drift(states: MirrorState[], file = REGISTRY): string[] {
  return states.flatMap((state) => {
    if (state.current === null)
      return [`${state.upstream} no longer exists at the pin. Remove ${state.entry.mirror} or update ${file}`]
    if (state.current === undefined || state.current === state.entry.sha) return []
    return [
      [
        `${state.upstream} changed upstream (recorded ${state.entry.sha.slice(0, 11)}, pin has ${state.current.slice(0, 11)}). Re-merge it into ${state.entry.mirror}.`,
        `  why: ${state.entry.why}`,
        ...state.entry.invariants.map((rule) => `  keep: ${rule}`),
        `  then record the new SHA in ${file}`,
      ].join("\n"),
    ]
  })
}
