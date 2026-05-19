import path from "path"
import {
  type ParseError as JsoncParseError,
  applyEdits,
  modify,
  parse as parseJsonc,
  printParseErrorCode,
} from "jsonc-parser"

import * as ConfigPaths from "@/config/paths"
import { Global } from "@opencode-ai/core/global"
import { Filesystem } from "@/util/filesystem"
import { Flock } from "@opencode-ai/core/util/flock"
import { isRecord } from "@/util/record"

import { parsePluginSpecifier, readPackageThemes, readPluginPackage, resolvePluginTarget } from "./shared"

type Mode = "noop" | "add" | "replace"
type Kind = "server" | "tui"
type ConfigName = "kilo" | "opencode" | "tui" // kilocode_change

export type Target = {
  kind: Kind
  opts?: Record<string, unknown>
}

export type InstallDeps = {
  resolve: (spec: string) => Promise<string>
}

export type PatchDeps = {
  readText: (file: string) => Promise<string>
  write: (file: string, text: string) => Promise<void>
  exists: (file: string) => Promise<boolean>
  files: (dir: string, name: ConfigName) => string[] // kilocode_change
}

export type PatchInput = {
  spec: string
  targets: Target[]
  force?: boolean
  global?: boolean
  vcs?: string
  worktree: string
  directory: string
  config?: string
}

type Ok<T> = {
  ok: true
} & T

type Err<C extends string, T> = {
  ok: false
  code: C
} & T

export type InstallResult = Ok<{ target: string }> | Err<"install_failed", { error: unknown }>

export type ManifestResult =
  | Ok<{ targets: Target[] }>
  | Err<"manifest_read_failed", { file: string; error: unknown }>
  | Err<"manifest_no_targets", { file: string }>

export type PatchItem = {
  kind: Kind
  mode: Mode
  file: string
}

type PatchErr =
  | Err<"invalid_json", { kind: Kind; file: string; line: number; col: number; parse: string }>
  | Err<"patch_failed", { kind: Kind; error: unknown }>

type PatchOne = Ok<{ item: PatchItem }> | PatchErr

export type PatchResult = Ok<{ dir: string; items: PatchItem[] }> | (PatchErr & { dir: string })

const defaultInstallDeps: InstallDeps = {
  resolve: (spec) => resolvePluginTarget(spec),
}

const defaultPatchDeps: PatchDeps = {
  readText: (file) => Filesystem.readText(file),
  write: async (file, text) => {
    await Filesystem.write(file, text)
  },
  exists: (file) => Filesystem.exists(file),
  files: (dir, name) => ConfigPaths.fileInDirectory(dir, name),
}

function pluginSpec(item: unknown) {
  if (typeof item === "string") return item
  if (!Array.isArray(item)) return
  if (typeof item[0] !== "string") return
  return item[0]
}

function pluginList(data: unknown) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return
  const item = data as { plugin?: unknown }
  if (!Array.isArray(item.plugin)) return
  return item.plugin
}

function exportValue(value: unknown): string | undefined {
  if (typeof value === "string") {
    const next = value.trim()
    if (next) return next
    return
  }
  if (!isRecord(value)) return
  for (const key of ["import", "default"]) {
    const next = value[key]
    if (typeof next !== "string") continue
    const hit = next.trim()
    if (!hit) continue
    return hit
  }
}

function exportOptions(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value)) return
  const config = value.config
  if (!isRecord(config)) return
  return config
}

function exportTarget(pkg: Record<string, unknown>, kind: Kind) {
  const exports = pkg.exports
  if (!isRecord(exports)) return
  const value = exports[`./${kind}`]
  const entry = exportValue(value)
  if (!entry) return
  return {
    opts: exportOptions(value),
  }
}

function hasMainTarget(pkg: Record<string, unknown>) {
  const main = pkg.main
  if (typeof main !== "string") return false
  return Boolean(main.trim())
}

function packageTargets(pkg: { json: Record<string, unknown>; dir: string; pkg: string }) {
  const spec =
    typeof pkg.json.name === "string" && pkg.json.name.trim().length > 0 ? pkg.json.name.trim() : path.basename(pkg.dir)
  const targets: Target[] = []
  const server = exportTarget(pkg.json, "server")
  if (server) {
    targets.push({ kind: "server", opts: server.opts })
  } else if (hasMainTarget(pkg.json)) {
    targets.push({ kind: "server" })
  }

  const tui = exportTarget(pkg.json, "tui")
  if (tui) {
    targets.push({ kind: "tui", opts: tui.opts })
  }

  if (!targets.some((item) => item.kind === "tui") && readPackageThemes(spec, pkg).length) {
    targets.push({ kind: "tui" })
  }

  return targets
}

function patch(text: string, path: Array<string | number>, value: unknown, insert = false) {
  return applyEdits(
    text,
    modify(text, path, value, {
      formattingOptions: {
        tabSize: 2,
        insertSpaces: true,
      },
      isArrayInsertion: insert,
    }),
  )
}

function patchPluginList(
  text: string,
  list: unknown[] | undefined,
  spec: string,
  next: unknown,
  force = false,
): { mode: Mode; text: string } {
  const pkg = parsePluginSpecifier(spec).pkg
  const rows = (list ?? []).map((item, i) => ({
    item,
    i,
    spec: pluginSpec(item),
  }))
  const dup = rows.filter((item) => {
    if (!item.spec) return false
    if (item.spec === spec) return true
    if (item.spec.startsWith("file://")) return false
    return parsePluginSpecifier(item.spec).pkg === pkg
  })

  if (!dup.length) {
    if (!list) {
      return {
        mode: "add",
        text: patch(text, ["plugin"], [next]),
      }
    }
    return {
      mode: "add",
      text: patch(text, ["plugin", list.length], next, true),
    }
  }

  if (!force) {
    return {
      mode: "noop",
      text,
    }
  }

  const keep = dup[0]
  if (!keep) {
    return {
      mode: "noop",
      text,
    }
  }

  if (dup.length === 1 && keep.spec === spec) {
    return {
      mode: "noop",
      text,
    }
  }

  let out = text
  if (typeof keep.item === "string") {
    out = patch(out, ["plugin", keep.i], next)
  }
  if (Array.isArray(keep.item) && typeof keep.item[0] === "string") {
    out = patch(out, ["plugin", keep.i, 0], spec)
  }

  const del = dup
    .map((item) => item.i)
    .filter((i) => i !== keep.i)
    .sort((a, b) => b - a)

  for (const i of del) {
    out = patch(out, ["plugin", i], undefined)
  }

  return {
    mode: "replace",
    text: out,
  }
}

export async function installPlugin(spec: string, dep: InstallDeps = defaultInstallDeps): Promise<InstallResult> {
  const target = await dep.resolve(spec).then(
    (item) => ({
      ok: true as const,
      item,
    }),
    (error: unknown) => ({
      ok: false as const,
      error,
    }),
  )
  if (!target.ok) {
    return {
      ok: false,
      code: "install_failed",
      error: target.error,
    }
  }
  return {
    ok: true,
    target: target.item,
  }
}

export async function readPluginManifest(target: string): Promise<ManifestResult> {
  const pkg = await readPluginPackage(target).then(
    (item) => ({
      ok: true as const,
      item,
    }),
    (error: unknown) => ({
      ok: false as const,
      error,
    }),
  )
  if (!pkg.ok) {
    return {
      ok: false,
      code: "manifest_read_failed",
      file: target,
      error: pkg.error,
    }
  }

  const targets = await Promise.resolve()
    .then(() => packageTargets(pkg.item))
    .then(
      (item) => ({ ok: true as const, item }),
      (error: unknown) => ({ ok: false as const, error }),
    )

  if (!targets.ok) {
    return {
      ok: false,
      code: "manifest_read_failed",
      file: pkg.item.pkg,
      error: targets.error,
    }
  }

  if (!targets.item.length) {
    return {
      ok: false,
      code: "manifest_no_targets",
      file: pkg.item.pkg,
    }
  }

  return {
    ok: true,
    targets: targets.item,
  }
}

// kilocode_change start - split plugin config root selection from Kilo/OpenCode config filename selection.
function patchRoot(input: PatchInput) {
  if (input.global) return input.config ?? Global.Path.config
  const git = input.vcs === "git" && input.worktree !== "/"
  return git ? input.worktree : input.directory
}

function patchName(kind: Kind): ConfigName {
  if (kind === "server") return "opencode"
  return "tui"
}

function kiloName(kind: Kind): ConfigName {
  if (kind === "server") return "kilo"
  return "tui"
}

async function existingFile(dir: string, name: ConfigName, dep: PatchDeps) {
  for (const file of dep.files(dir, name)) {
    if (await dep.exists(file)) return { dir, name }
  }
}

async function hasKiloConfig(dir: string, dep: PatchDeps) {
  return Boolean((await existingFile(dir, "kilo", dep)) ?? (await existingFile(dir, "tui", dep)))
}

async function patchLocation(input: PatchInput, target: Target, dep: PatchDeps) {
  const root = patchRoot(input)
  const legacy = patchName(target.kind)
  const kilo = kiloName(target.kind)

  if (input.global) {
    if (await hasKiloConfig(root, dep)) return (await existingFile(root, kilo, dep)) ?? { dir: root, name: kilo }
    const existing = await existingFile(root, legacy, dep)
    if (existing) return existing
    return { dir: root, name: legacy }
  }

  if (await hasKiloConfig(root, dep)) return (await existingFile(root, kilo, dep)) ?? { dir: root, name: kilo }

  const rootKilo = await existingFile(root, kilo, dep)
  if (rootKilo) return rootKilo

  const kiloDir = path.join(root, ".kilo")
  if (await dep.exists(kiloDir)) {
    return (await existingFile(kiloDir, kilo, dep)) ?? (await existingFile(kiloDir, legacy, dep)) ?? { dir: kiloDir, name: kilo }
  }

  const rootLegacy = await existingFile(root, legacy, dep)
  if (rootLegacy) return rootLegacy

  const legacyDir = path.join(root, ".opencode")
  return (await existingFile(legacyDir, legacy, dep)) ?? { dir: legacyDir, name: legacy }
}
// kilocode_change end

// kilocode_change start - pass the selected Kilo/OpenCode config filename into each patch operation.
async function patchOne(
  dir: string,
  name: ConfigName,
  target: Target,
  spec: string,
  force: boolean,
  dep: PatchDeps,
): Promise<PatchOne> {
// kilocode_change end
  await using _ = await Flock.acquire(`plug-config:${Filesystem.resolve(path.join(dir, name))}`)

  const files = dep.files(dir, name)
  let cfg = files[0]
  for (const file of files) {
    if (!(await dep.exists(file))) continue
    cfg = file
    break
  }

  const src = await dep.readText(cfg).catch((err: NodeJS.ErrnoException) => {
    if (err.code === "ENOENT") return "{}"
    return err
  })
  if (src instanceof Error) {
    return {
      ok: false,
      code: "patch_failed",
      kind: target.kind,
      error: src,
    }
  }
  const text = src.trim() ? src : "{}"

  const errs: JsoncParseError[] = []
  const data = parseJsonc(text, errs, { allowTrailingComma: true })
  if (errs.length) {
    const err = errs[0]
    const lines = text.substring(0, err.offset).split("\n")
    return {
      ok: false,
      code: "invalid_json",
      kind: target.kind,
      file: cfg,
      line: lines.length,
      col: lines[lines.length - 1].length + 1,
      parse: printParseErrorCode(err.error),
    }
  }

  const list = pluginList(data)
  const item = target.opts ? ([spec, target.opts] as const) : spec
  const out = patchPluginList(text, list, spec, item, force)
  if (out.mode === "noop") {
    return {
      ok: true,
      item: {
        kind: target.kind,
        mode: out.mode,
        file: cfg,
      },
    }
  }

  const write = await dep.write(cfg, out.text).catch((error: unknown) => error)
  if (write instanceof Error) {
    return {
      ok: false,
      code: "patch_failed",
      kind: target.kind,
      error: write,
    }
  }

  return {
    ok: true,
    item: {
      kind: target.kind,
      mode: out.mode,
      file: cfg,
    },
  }
}

export async function patchPluginConfig(input: PatchInput, dep: PatchDeps = defaultPatchDeps): Promise<PatchResult> {
  const items: PatchItem[] = []
  let dir = patchRoot(input) // kilocode_change
  for (const target of input.targets) {
    const location = await patchLocation(input, target, dep) // kilocode_change
    dir = location.dir // kilocode_change
    const hit = await patchOne(location.dir, location.name, target, input.spec, Boolean(input.force), dep) // kilocode_change
    if (!hit.ok) {
      return {
        ...hit,
        dir,
      }
    }
    items.push(hit.item)
  }
  return {
    ok: true,
    dir,
    items,
  }
}
