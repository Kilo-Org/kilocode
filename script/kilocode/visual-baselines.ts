// Check and apply the screenshot baselines that a pull request run of
// "Visual Regression Tests" uploads as artifacts.
//
// That run executes pull request code, so its artifacts are untrusted input.
// Each job uploads one artifact, downloaded here into `<root>/<job>/`. It holds
// `meta.json` (pull request number, head commit, head repository, head branch
// and the baselines the run deleted) and `files/<repo path>` for every new or
// changed baseline. Only regular PNG files under the baseline directory of the
// artifact's own job are accepted. Symlinks, `..`, other names and other entries
// are refused, and the metadata must match the workflow_run payload. Nothing is
// written until every artifact has passed.
//
// Usage: bun script/kilocode/visual-baselines.ts <artifacts dir> <checkout dir>
// with VR_SHA, VR_REF, VR_REPO and VR_PRS (the payload's `pull_requests` JSON).

import { copyFileSync, lstatSync, mkdirSync, readdirSync, rmSync } from "node:fs"
import path from "node:path"

export const DIRS = {
  "kilo-ui": "packages/kilo-docs/public/img/screenshot-tests/kilo-ui/",
  "kilo-vscode": "packages/kilo-docs/public/img/screenshot-tests/kilo-vscode/",
} as const

export type Expected = {
  sha: string
  ref: string
  repo: string
  prs: { number: number; head: { sha: string; ref: string } }[]
}

export type Plan = { write: { from: string; to: string }[]; remove: string[] }

type Meta = { pr?: unknown; head_sha?: unknown; head_repo?: unknown; head_ref?: unknown; deleted?: unknown }

const SEGMENT = /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/
// PNG signature, then the first chunk: length 13, type IHDR.
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]

// A repo-relative PNG path under `prefix` whose every segment is a plain name.
export function allowed(file: string, prefix: string) {
  if (!file.startsWith(prefix) || !file.endsWith(".png")) return false
  return file.split("/").every((part) => SEGMENT.test(part))
}

function entries(dir: string, rel = ""): string[] {
  return readdirSync(dir)
    .sort()
    .flatMap((name) => {
      const full = path.join(dir, name)
      const next = rel ? `${rel}/${name}` : name
      const stat = lstatSync(full)
      if (stat.isDirectory()) return entries(full, next)
      if (!stat.isFile()) throw new Error(`not a regular file: ${next}`)
      return [next]
    })
}

async function png(file: string) {
  const head = await Bun.file(file).slice(0, PNG.length).bytes()
  return head.length === PNG.length && PNG.every((byte, i) => head[i] === byte)
}

export async function validate(root: string, expected: Expected) {
  const plan: Plan = { write: [], remove: [] }
  const top = lstatSync(root, { throwIfNoEntry: false })
  if (top == null) return plan
  if (!top.isDirectory()) throw new Error(`not a directory: ${root}`)
  for (const job of readdirSync(root).sort()) {
    const prefix = Object.entries(DIRS).find((entry) => entry[0] === job)?.[1]
    if (prefix == null) throw new Error(`unexpected artifact: ${job}`)
    const dir = path.join(root, job)
    if (!lstatSync(dir).isDirectory()) throw new Error(`not a directory: ${job}`)
    const names = readdirSync(dir)
    const extra = names.find((name) => name !== "meta.json" && name !== "files")
    if (extra != null) throw new Error(`unexpected entry: ${job}/${extra}`)
    if (!lstatSync(path.join(dir, "meta.json"), { throwIfNoEntry: false })?.isFile()) {
      throw new Error(`missing meta.json: ${job}`)
    }
    const meta: Meta = await Bun.file(path.join(dir, "meta.json")).json()
    if (meta.head_sha !== expected.sha) throw new Error(`${job}: head commit does not match the run`)
    if (meta.head_ref !== expected.ref) throw new Error(`${job}: head branch does not match the run`)
    if (meta.head_repo !== expected.repo) throw new Error(`${job}: head repository does not match the run`)
    const pr = expected.prs.find((item) => item.number === meta.pr)
    if (pr == null || pr.head.sha !== expected.sha || pr.head.ref !== expected.ref) {
      throw new Error(`${job}: pull request does not match the run`)
    }
    const deleted = meta.deleted
    if (!Array.isArray(deleted) || !deleted.every((file) => typeof file === "string")) {
      throw new Error(`${job}: deleted must be a list of paths`)
    }

    const files = path.join(dir, "files")
    const listed = names.includes("files")
    if (listed && !lstatSync(files).isDirectory()) throw new Error(`not a directory: ${job}/files`)
    for (const file of listed ? entries(files) : []) {
      if (!allowed(file, prefix)) throw new Error(`${job}: path not allowed: ${file}`)
      const from = path.join(files, file)
      if (!(await png(from))) throw new Error(`${job}: not a PNG image: ${file}`)
      plan.write.push({ from, to: file })
    }
    for (const file of new Set<string>(deleted)) {
      if (!allowed(file, prefix)) throw new Error(`${job}: path not allowed: ${file}`)
      if (plan.write.some((item) => item.to === file)) throw new Error(`${job}: path both written and deleted: ${file}`)
      plan.remove.push(file)
    }
  }
  return plan
}

// Refuse a target path that a symlink in the checkout would redirect.
function check(target: string, file: string) {
  const parts = file.split("/")
  parts.reduce((dir, part, i) => {
    const next = path.join(dir, part)
    const stat = lstatSync(next, { throwIfNoEntry: false })
    if (stat == null) return next
    if (stat.isSymbolicLink()) throw new Error(`symlink in checkout: ${file}`)
    if (i < parts.length - 1 ? !stat.isDirectory() : !stat.isFile()) {
      throw new Error(`unexpected entry in checkout: ${file}`)
    }
    return next
  }, target)
}

export function apply(plan: Plan, target: string) {
  for (const file of [...plan.write.map((item) => item.to), ...plan.remove]) check(target, file)
  for (const item of plan.write) {
    const dest = path.join(target, item.to)
    mkdirSync(path.dirname(dest), { recursive: true })
    copyFileSync(item.from, dest)
  }
  for (const file of plan.remove) rmSync(path.join(target, file), { force: true })
}

if (import.meta.main) {
  const [root, target] = process.argv.slice(2)
  if (!root || !target) throw new Error("usage: visual-baselines.ts <artifacts dir> <checkout dir>")
  const sha = process.env.VR_SHA ?? ""
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error("VR_SHA must be a commit SHA")
  const expected: Expected = {
    sha,
    ref: process.env.VR_REF ?? "",
    repo: process.env.VR_REPO ?? "",
    prs: JSON.parse(process.env.VR_PRS ?? "[]"),
  }
  if (!expected.ref || !expected.repo) throw new Error("VR_REF and VR_REPO are required")
  const plan = await validate(root, expected)
  apply(plan, target)
  for (const item of plan.write) console.log(`write ${item.to}`)
  for (const file of plan.remove) console.log(`remove ${file}`)
}
