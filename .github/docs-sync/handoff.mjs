// kilocode_change - new file

/**
 * Hands the result of the docs-sync agent job to the publish job.
 *
 *   node handoff.mjs pack   agent job: commit the packages/kilo-docs changes on
 *                           the integration branch and write the handoff directory
 *   node handoff.mjs check  publish job: check the downloaded handoff before any
 *                           step holds a credential, and stage it for upsert-pr.mjs
 *
 * The publish job treats the handoff as data and accepts only its expected shape:
 *   - the handoff directory holds only the fixed file names below, as regular files;
 *   - every JSON file is at most 20 MB and parses (the data files to arrays);
 *   - every scalar in handoff.json matches its exact format;
 *   - the docs bundle is a v2 bundle of at most 10 MB with the single head
 *     refs/heads/docs-sync-handoff, and is fetched with object checks. Its
 *     prerequisite (base_main) must lie on main between the commit this run
 *     started from (GITHUB_SHA) and origin/main now, so it is a main commit
 *     pushed during this run at the oldest. `check` fetches main first:
 *     actions/checkout resets origin/main to the run's commit, while the agent
 *     job may have built on a newer main;
 *   - each commit the bundle adds changes packages/kilo-docs/ alone, and so does
 *     the whole tip against main, with no symlink, no submodule, no mode change
 *     and no new executable file.
 * It never checks the bundle out into the workspace and runs no file from it.
 * `durable_base` is the push lease for upsert-pr.mjs: the tip of the target
 * branch the agent job built on (empty: it did not exist). It decides nothing
 * but whether a branch that moved during the run is overwritten (it is not).
 * It guards honest races only: the agent job chooses the value, so it is no
 * security check. `marker_prs` lists the pull requests learn.mjs read for the
 * marker (at most 50); upsert-pr.mjs re-reads each and patches only this
 * repository's own auto-docs surface PRs among them.
 *
 * Env (pack): HANDOFF_DIR, WORTHY_COUNT, SINCE, NOW, SINCE_OVERRIDE,
 *   LEARNED_THROUGH, MARKER_PATCH, MARKER_PRS, BRANCH, VERIFIED.
 * Env (check): HANDOFF_DIR, GITHUB_SHA (the commit this run started from).
 */

import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { DEFAULT_BRANCH, INTEGRATION_BRANCH } from "./prepare-branch.mjs"

export const DOCS_PREFIX = "packages/kilo-docs/"
export const HANDOFF_REF = "refs/heads/docs-sync-handoff"
export const FETCHED_REF = "refs/docs-sync/handoff"
export const BUNDLE_MAX_BYTES = 10 * 1024 * 1024
export const JSON_MAX_BYTES = 20 * 1024 * 1024

const MANIFEST = "handoff.json"
const BUNDLE = "docs.bundle"

/**
 * The branch the integration tree is pushed to: a conflicted run's dated
 * fallback branch, else the durability ref. Git refs cannot hold both
 * `docs/auto-sync` and `docs/auto-sync/<surface>` (a ref may not be a path
 * prefix of another ref), so the surface PRs use `docs/auto-sync/<surface>`
 * heads and the tree goes to this sibling ref, so a failed surface cannot lose
 * the run's changes.
 */
export function durableBranch(branch) {
  return branch && branch !== DEFAULT_BRANCH ? branch : INTEGRATION_BRANCH
}

/**
 * Handoff data file → its path in the workspace: where the agent job writes it
 * and where upsert-pr.mjs reads it in the publish job.
 */
export const DATA_FILES = {
  "triage.json": "docs-sync-out/triage.json",
  "worthy.json": "docs-sync-out/worthy.json",
  "digest-full.json": "docs-sync-out/digest-full.json",
  "edit-summary.json": ".docs-sync-summary.json",
}

const ISO_MS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
const SHA = /^[0-9a-f]{40}$/
const LEARNED_THROUGH =
  /^<!-- docs-sync: learned-through commit=(none|[0-9a-f]{40}(,[0-9a-f]{40})*) comment=(none|\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z) -->$/

/** Each manifest key and the values it accepts. */
const SCALARS = {
  since: (v) => ISO_MS.test(v) && Number.isFinite(Date.parse(v)),
  now: (v) => ISO_MS.test(v) && Number.isFinite(Date.parse(v)),
  since_override: (v) => v === "true" || v === "false",
  learned_through: (v) => v === "" || LEARNED_THROUGH.test(v),
  marker_patch: (v) => v === "" || LEARNED_THROUGH.test(v),
  marker_prs: (v) => /^(\d{1,10}(,\d{1,10}){0,49})?$/.test(v),
  branch: (v) => v === "" || /^docs\/auto-sync(-\d{4}-\d{2}-\d{2})?$/.test(v),
  verified: (v) => v === "" || v === "true" || v === "false",
  has_edits: (v) => v === "true" || v === "false",
  base_main: (v) => v === "" || SHA.test(v),
  durable_base: (v) => v === "" || SHA.test(v),
}

function gitRunner(cwd) {
  return (args, { raw = false } = {}) => {
    const out = execFileSync("git", args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 64 * 1024 * 1024,
    }).toString()
    return raw ? out : out.trim()
  }
}

// --- pack (agent job) ---

/**
 * Commit the docs changes and write the handoff directory. Returns the step
 * outputs: `publish` (the publish job has work: the docs pass ran, or learn
 * handed over a marker) and `has_edits`.
 */
export function pack({ cwd = process.cwd(), env = process.env } = {}) {
  const git = gitRunner(cwd)
  const dir = env.HANDOFF_DIR
  if (!dir) throw new Error("HANDOFF_DIR is required")
  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(dir, { recursive: true })

  for (const [name, source] of Object.entries(DATA_FILES)) {
    const from = path.join(cwd, source)
    if (fs.existsSync(from)) fs.copyFileSync(from, path.join(dir, name))
  }

  // The docs pass (prepare-branch onward) ran only when triage found docs-worthy PRs.
  const docsPass = Number(env.WORTHY_COUNT || "0") > 0
  const dirty = docsPass && git(["status", "--porcelain", "--", DOCS_PREFIX]) !== ""
  let baseMain = ""
  let durableBase = ""
  if (dirty) {
    const date = String(env.NOW || new Date().toISOString()).slice(0, 10)
    git(["add", DOCS_PREFIX])
    git(["commit", "-m", `docs: sync with merged PRs (${date})`])
    git(["update-ref", HANDOFF_REF, "HEAD"])
    baseMain = git(["rev-parse", "origin/main^{commit}"])
    // Thin bundle: everything the integration branch adds over this run's main.
    git(["bundle", "create", path.join(dir, BUNDLE), HANDOFF_REF, `^${baseMain}`])
    // The publish job's push lease: the tip of the target branch this job
    // built on, or empty when it did not exist.
    try {
      durableBase = git(["rev-parse", "--verify", "-q", `refs/remotes/origin/${durableBranch(env.BRANCH)}^{commit}`])
    } catch {
      durableBase = ""
    }
  }

  const manifest = {
    since: env.SINCE ?? "",
    now: env.NOW ?? "",
    since_override: env.SINCE_OVERRIDE ?? "",
    learned_through: env.LEARNED_THROUGH ?? "",
    marker_patch: env.MARKER_PATCH ?? "",
    marker_prs: env.MARKER_PATCH ? (env.MARKER_PRS ?? "") : "",
    branch: dirty ? (env.BRANCH ?? "") : "",
    verified: env.VERIFIED ?? "",
    has_edits: dirty ? "true" : "false",
    base_main: baseMain,
    durable_base: durableBase,
  }
  fs.writeFileSync(path.join(dir, MANIFEST), JSON.stringify(manifest, null, 2))

  const publish = docsPass || manifest.marker_patch !== ""
  return { publish: publish ? "true" : "false", has_edits: manifest.has_edits }
}

// --- check (publish job) ---

/** Read and parse one JSON file of the handoff, bounded. */
function readJsonFile(file, name) {
  const size = fs.lstatSync(file).size
  if (size > JSON_MAX_BYTES) throw new Error(`${name} is ${size} bytes, over the ${JSON_MAX_BYTES}-byte limit`)
  const text = fs.readFileSync(file, "utf8")
  try {
    return { text, value: JSON.parse(text) }
  } catch (err) {
    throw new Error(`${name} does not parse as JSON: ${err.message}`)
  }
}

/** The directory listing: fixed names only, each a regular file. */
function listHandoff(dir) {
  const st = fs.lstatSync(dir)
  if (!st.isDirectory()) throw new Error(`the handoff ${dir} is not a directory`)
  const allowed = new Set([MANIFEST, BUNDLE, ...Object.keys(DATA_FILES)])
  const names = new Set()
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!allowed.has(entry.name)) throw new Error(`unexpected handoff entry: ${JSON.stringify(entry.name)}`)
    if (!fs.lstatSync(path.join(dir, entry.name)).isFile()) {
      throw new Error(`handoff entry ${entry.name} is not a regular file`)
    }
    names.add(entry.name)
  }
  if (!names.has(MANIFEST)) throw new Error(`the handoff has no ${MANIFEST}`)
  return names
}

/** Validate the manifest: exactly the known keys, each a string in its format. */
export function validateManifest(manifest) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new Error(`${MANIFEST} must be an object`)
  }
  const keys = Object.keys(manifest).sort()
  const expected = Object.keys(SCALARS).sort()
  if (JSON.stringify(keys) !== JSON.stringify(expected)) {
    throw new Error(`${MANIFEST} keys must be exactly ${expected.join(", ")}; got ${keys.join(", ")}`)
  }
  for (const [key, ok] of Object.entries(SCALARS)) {
    const value = manifest[key]
    if (typeof value !== "string" || !ok(value)) {
      throw new Error(`${MANIFEST} ${key} has an invalid value: ${JSON.stringify(value)}`)
    }
  }
  if (manifest.has_edits === "true") {
    for (const key of ["branch", "base_main"]) {
      if (manifest[key] === "") throw new Error(`${MANIFEST} ${key} is required when has_edits is true`)
    }
  } else {
    for (const key of ["branch", "base_main", "durable_base"]) {
      if (manifest[key] !== "") throw new Error(`${MANIFEST} ${key} must be empty when has_edits is false`)
    }
  }
  if ((manifest.marker_patch === "") !== (manifest.marker_prs === "")) {
    throw new Error(`${MANIFEST} marker_patch and marker_prs must both be set or both be empty`)
  }
  return manifest
}

/**
 * Parse `git diff-tree`/`git diff` --raw -z output into entries of
 * { modes, path }. `modes` lists each parent's mode, then the result's mode
 * (one parent for a plain diff, several for a combined -c diff).
 */
export function parseRaw(out) {
  const fields = out.split("\0")
  const entries = []
  for (let i = 0; i + 1 < fields.length; i += 2) {
    const meta = fields[i].replace(/^\n/, "")
    if (meta === "") break
    const colons = meta.match(/^:+/)?.[0].length ?? 0
    if (colons === 0) throw new Error(`unexpected raw diff record: ${JSON.stringify(meta)}`)
    const modes = meta.slice(colons).split(" ").slice(0, colons + 1)
    entries.push({ modes, path: fields[i + 1] })
  }
  return entries
}

/** Every rule a changed path must meet, wherever it comes from. */
export function checkEntry({ modes, path: file }, where) {
  if (!file.startsWith(DOCS_PREFIX) || file.split("/").some((s) => s === ".." || s === ".")) {
    throw new Error(`${where} changes a path outside ${DOCS_PREFIX}: ${JSON.stringify(file)}`)
  }
  const result = modes[modes.length - 1]
  const parents = modes.slice(0, -1).filter((m) => m !== "000000")
  for (const mode of modes) {
    if (mode === "120000") throw new Error(`${where} adds a symlink: ${file}`)
    if (mode === "160000") throw new Error(`${where} adds a submodule: ${file}`)
  }
  if (result === "000000") return
  if (parents.length > 0 && !parents.includes(result)) {
    throw new Error(`${where} changes the mode of ${file} to ${result}`)
  }
  if (parents.length === 0 && result !== "100644") {
    throw new Error(`${where} adds ${file} with mode ${result}; a new file must be 100644`)
  }
}

/**
 * Fetch and check the bundle. Returns the checked tip. `baseMain` and `runSha`
 * must already be 40-hex ids.
 */
export function checkBundle({ bundle, baseMain, runSha, git }) {
  const size = fs.lstatSync(bundle).size
  if (size > BUNDLE_MAX_BYTES) throw new Error(`${BUNDLE} is ${size} bytes, over the ${BUNDLE_MAX_BYTES}-byte limit`)
  const header = Buffer.alloc(16)
  const fd = fs.openSync(bundle, "r")
  try {
    fs.readSync(fd, header, 0, 16, 0)
  } finally {
    fs.closeSync(fd)
  }
  if (header.toString("latin1") !== "# v2 git bundle\n") throw new Error(`${BUNDLE} is not a v2 git bundle`)

  // actions/checkout resets origin/main to the run's commit when main moved;
  // the agent job may have built on a newer main, so read main as it is now.
  // The repository is public, so this needs no credential.
  git(["fetch", "--quiet", "--no-tags", "origin", "+refs/heads/main:refs/remotes/origin/main"])
  try {
    git(["merge-base", "--is-ancestor", baseMain, "refs/remotes/origin/main"])
  } catch {
    throw new Error(`base_main ${baseMain} is not a commit of origin/main`)
  }
  // The agent job's checkout is at or after the run's commit, so its main is
  // too. An older base would widen the tip-against-main check below.
  try {
    git(["merge-base", "--is-ancestor", runSha, baseMain])
  } catch {
    throw new Error(`base_main ${baseMain} is older than the commit this run started from (${runSha})`)
  }
  try {
    git(["bundle", "verify", "-q", bundle])
  } catch (err) {
    throw new Error(`${BUNDLE} does not verify against this repository: ${String(err.stderr ?? err.message).trim()}`)
  }
  const heads = git(["bundle", "list-heads", bundle]).split("\n").filter(Boolean)
  const head = heads.length === 1 ? heads[0].match(/^([0-9a-f]{40}) (\S+)$/) : null
  if (!head || head[2] !== HANDOFF_REF) {
    throw new Error(`${BUNDLE} must hold exactly ${HANDOFF_REF}; it lists ${JSON.stringify(heads)}`)
  }

  git([
    "-c",
    "transfer.fsckObjects=true",
    "-c",
    "fetch.fsckObjects=true",
    "fetch",
    "--quiet",
    "--no-tags",
    "--no-write-fetch-head",
    bundle,
    `+${HANDOFF_REF}:${FETCHED_REF}`,
  ])
  const tip = git(["rev-parse", "--verify", `${FETCHED_REF}^{commit}`])
  if (tip !== head[1]) throw new Error(`the fetched tip ${tip} is not the listed head ${head[1]}`)
  try {
    git(["merge-base", "--is-ancestor", baseMain, tip])
  } catch {
    throw new Error(`base_main ${baseMain} is not an ancestor of the handoff tip ${tip}`)
  }

  // Each commit the handoff adds over main and the docs branches already on
  // origin must change docs files only: a merge is held to the paths that
  // match none of its parents.
  const added = git([
    "rev-list",
    tip,
    "--not",
    "refs/remotes/origin/main",
    "--glob=refs/remotes/origin/docs/auto-sync*",
    "--glob=refs/remotes/origin/docs/auto-sync/*",
  ])
    .split("\n")
    .filter(Boolean)
  for (const commit of added) {
    const parents = git(["rev-list", "--parents", "-n", "1", commit]).split(" ").slice(1)
    const where = `handoff commit ${commit}`
    if (parents.length === 0) throw new Error(`${where} has no parent`)
    const out =
      parents.length === 1
        ? git(["diff-tree", "-r", "-z", "--no-renames", "--raw", parents[0], commit], { raw: true })
        : git(["diff-tree", "-r", "-z", "--no-renames", "--no-commit-id", "-c", "--raw", commit], { raw: true })
    for (const entry of parseRaw(out)) checkEntry(entry, where)
  }

  // The tip against main: a path outside the docs passes only where it holds
  // origin/main's current content (a main commit merged in from a surface branch).
  const sinceBase = parseRaw(git(["diff", "-z", "--no-renames", "--raw", baseMain, tip], { raw: true }))
  const fromMain = new Set(
    git(["diff", "-z", "--no-renames", "--name-only", "refs/remotes/origin/main", tip], { raw: true })
      .split("\0")
      .filter(Boolean),
  )
  for (const entry of sinceBase) {
    if (fromMain.has(entry.path)) checkEntry(entry, "the handoff tip")
  }
  return tip
}

/**
 * Check the handoff in `HANDOFF_DIR` and stage the data files where
 * upsert-pr.mjs reads them. Returns the step outputs.
 */
export function check({ cwd = process.cwd(), env = process.env } = {}) {
  const git = gitRunner(cwd)
  const dir = env.HANDOFF_DIR
  if (!dir) throw new Error("HANDOFF_DIR is required")
  const names = listHandoff(dir)

  const manifest = validateManifest(readJsonFile(path.join(dir, MANIFEST), MANIFEST).value)
  const hasBundle = names.has(BUNDLE)
  if (manifest.has_edits === "true" && !hasBundle) throw new Error(`has_edits is true but the handoff has no ${BUNDLE}`)
  if (manifest.has_edits !== "true" && hasBundle) throw new Error(`has_edits is false but the handoff has a ${BUNDLE}`)

  const staged = []
  for (const name of Object.keys(DATA_FILES)) {
    if (!names.has(name)) continue
    const { text, value } = readJsonFile(path.join(dir, name), name)
    if (!Array.isArray(value)) throw new Error(`${name} must hold a JSON array`)
    staged.push({ name, text })
  }

  let integrationSha = ""
  if (hasBundle) {
    const runSha = env.GITHUB_SHA ?? ""
    if (!SHA.test(runSha)) throw new Error(`GITHUB_SHA must be the run's commit id; got ${JSON.stringify(runSha)}`)
    integrationSha = checkBundle({ bundle: path.join(dir, BUNDLE), baseMain: manifest.base_main, runSha, git })
  }

  for (const { name, text } of staged) {
    const dest = path.join(cwd, DATA_FILES[name])
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.rmSync(dest, { force: true })
    fs.writeFileSync(dest, text)
  }

  return {
    since: manifest.since,
    now: manifest.now,
    since_override: manifest.since_override,
    learned_through: manifest.learned_through,
    marker_patch: manifest.marker_patch,
    marker_prs: manifest.marker_prs,
    branch: manifest.branch,
    verified: manifest.verified,
    has_edits: manifest.has_edits,
    integration_sha: integrationSha,
    base_main: manifest.base_main,
    durable_base: manifest.durable_base,
  }
}

async function main() {
  const { appendOutput } = await import("./lib.mjs")
  const command = process.argv[2]
  let outputs
  if (command === "pack") outputs = pack()
  else if (command === "check") outputs = check()
  else throw new Error(`usage: handoff.mjs pack|check (got ${JSON.stringify(command)})`)
  for (const [name, value] of Object.entries(outputs)) appendOutput(name, value)
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
  main().catch((err) => {
    console.error(`::error::docs-sync handoff: ${err.message}`)
    process.exit(1)
  })
}
