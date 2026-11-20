import { parseTree, findNodeAtLocation, type ParseError } from "jsonc-parser"
import { createHash, randomUUID } from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { legacyRoots } from "./resource-roots"

type Roots = {
  home: string
  legacyState: string
  v1State: string
  previewState: string
  configBase: string
  legacyConfig: string
  previewConfig: string
}
type Kind = "model" | "workflow" | "skill"
type Item = { kind: Kind; source: string; target: string; digest: string }
type Inventory = { conflicts: Set<string>; items: Map<string, Item> }

/** Read-only inventory. Publish after the config plan and before switching the database. */
export function planExtra(opts: Roots) {
  const roots = { ...opts }
  const initial = inventory(roots)
  const expected = fingerprint(initial)
  function checked() {
    const fresh = inventory(roots)
    if (fresh.conflicts.size) throw new Error([...fresh.conflicts].sort().join("\n"))
    if (fingerprint(fresh) !== expected) throw new Error("Profile resources changed; repeat migration preflight")
    return fresh
  }
  return {
    conflicts: [...initial.conflicts].sort(),
    files: [...initial.items.values()],
    apply() {
      if (initial.conflicts.size) throw new Error([...initial.conflicts].sort().join("\n"))
      for (const item of checked().items.values()) publish(item)
      for (const item of checked().items.values()) {
        if (hash(read(item.target)) !== item.digest) throw new Error(`Published resource changed: ${item.target}`)
      }
    },
  }
}

function fingerprint(plan: Inventory) {
  return JSON.stringify(
    [...plan.items.values()].map((item) => [item.target, item.digest]).sort(([a], [b]) => a!.localeCompare(b!)),
  )
}

function inventory(roots: Roots) {
  const plan: Inventory = { conflicts: new Set(), items: new Map() }
  if (Object.values(roots).some((dir) => !path.isAbsolute(dir))) {
    plan.conflicts.add("Supply absolute home, state and configuration roots before migrating")
    return plan
  }
  const stable = path.join(roots.legacyState, "model.json")
  for (const dir of new Set([roots.legacyState, roots.v1State, roots.previewState])) {
    const file = path.join(dir, "model.json")
    inspect(plan, () => {
      if (entry(file)) record(plan, "model", file, stable)
    })
  }

  const { dot, storage, modes: modeFiles } = legacyRoots(roots.home, roots.configBase)
  for (const dir of [...dot, ...storage]) {
    // The config plan owns the complete inventory if an explicit override points here.
    if (dir === roots.legacyConfig || dir === roots.previewConfig) continue
    inspect(plan, () => workflows(plan, roots, dir))
    for (const name of dot.includes(dir) ? ["skills", "skill"] : ["skills"]) {
      inspect(plan, () => skills(plan, roots, path.join(dir, name)))
    }
  }
  for (const file of modeFiles) inspect(plan, () => modes(file, roots.legacyConfig))
  for (const dir of dot) {
    if (dir === roots.legacyConfig || dir === roots.previewConfig) continue
    for (const name of ["mode", "modes"])
      inspect(plan, () => {
        for (const child of children(path.join(dir, name)).filter((file) => file.name.endsWith(".md")))
          plan.conflicts.add(
            `Review mode permissions, port ${path.join(dir, name, child.name)} to ${roots.legacyConfig}/agents and archive the original before switching`,
          )
      })
  }
  const resources = [...plan.items.values()].filter((item) => item.kind !== "model")
  if (resources.length) {
    for (const dir of [roots.legacyConfig, roots.previewConfig])
      for (const check of [commandClaims, skillClaims])
        inspect(plan, () => check(plan, dir, roots.legacyConfig, resources))
  }
  return plan
}

function inspect(plan: Inventory, check: () => void) {
  try {
    check()
  } catch (error) {
    plan.conflicts.add(error instanceof Error ? error.message : String(error))
  }
}

function modes(file: string, config: string) {
  if (!entry(file)) return
  const bytes = read(file)
  try {
    const doc = Bun.YAML.parse(bytes.toString("utf8"))
    if (doc == null || (recordObject(doc) && Array.isArray(doc.customModes) && doc.customModes.length === 0)) return
  } catch {
    // Parser errors can include private prompts from the YAML.
  }
  throw new Error(
    `Convert custom mode permissions from ${file} to agents in ${config} and archive the legacy file before switching`,
  )
}

function workflows(plan: Inventory, roots: Roots, dir: string) {
  const base = path.join(dir, "workflows")
  for (const child of children(base)) {
    if (child.isDirectory() || !child.name.endsWith(".md")) continue
    inspect(plan, () =>
      record(plan, "workflow", path.join(base, child.name), path.join(roots.legacyConfig, "command", child.name)),
    )
  }
}

// Only discover named manifests. Unrelated editor files, settings, caches and histories
// never enter the inventory. Don't silently activate half of a skill bundle or move its scripts.
function skills(plan: Inventory, roots: Roots, base: string) {
  function visit(dir: string) {
    const entries = children(dir)
    const file = path.join(dir, "SKILL.md")
    if (entries.some((child) => child.name === "SKILL.md")) {
      if (
        dir === base ||
        entries.length !== 1 ||
        path
          .relative(base, dir)
          .split(path.sep)
          .some((part) => part.startsWith("."))
      ) {
        plan.conflicts.add(
          `Review and port the complete skill bundle at ${file} (including its assets) into ${roots.legacyConfig}/skills; archive the original after review`,
        )
        return
      }
      inspect(plan, () =>
        record(plan, "skill", file, path.join(roots.legacyConfig, "skills", path.basename(dir), "SKILL.md")),
      )
      return
    }
    for (const child of entries) {
      if (child.isSymbolicLink())
        plan.conflicts.add(`Inspect the linked skill entry without following it: ${path.join(dir, child.name)}`)
      if (child.isDirectory()) visit(path.join(dir, child.name))
    }
  }
  visit(base)
}

function record(plan: Inventory, kind: Kind, source: string, target: string) {
  const digest = hash(output(kind, source))
  const key = fold(target)
  const prior = plan.items.get(key)
  if (prior && (prior.digest !== digest || prior.target !== target)) {
    plan.conflicts.add(`Reconcile ${prior.source} and ${source} before switching: both need ${target}`)
    return
  }
  if (!prior) plan.items.set(key, { kind, source, target, digest })
}

function output(kind: Kind, source: string) {
  const bytes = read(source)
  const text = bytes.toString("utf8")
  if (kind === "model") {
    const errors: ParseError[] = []
    if (parseTree(text, errors, { disallowComments: true })?.type !== "object" || errors.length)
      throw new Error(`Repair the model preference JSON object at ${source} before switching`)
    return bytes // Preserve unknown settings and ordering, including per-agent model selections.
  }
  const name = kind === "skill" ? path.basename(path.dirname(source)) : path.basename(source, ".md")
  if (!/^[a-zA-Z0-9][\w.-]*$/.test(name)) throw new Error(`Review the non-portable ${kind} name at ${source}`)
  if (
    !Buffer.from(text).equals(bytes) ||
    text.includes("\0") ||
    /\{(?:env|file):|!`|\]\(<?(?!https?:|\/|#|~\/|mailto:)[^\s)]+/i.test(text)
  )
    throw new Error(`Review ${kind} encoding, substitutions or relative references before relocating ${source}`)
  if (kind === "skill") {
    if (standaloneSkill(text, name)) return bytes
    throw new Error(`Check the skill name and frontmatter against its discovery directory before migrating ${source}`)
  }
  const body = text.trim()
  const lines = body.split(/\r?\n/).map((line) => line.trim())
  const heading = lines.findIndex((line) => line.startsWith("#"))
  const description =
    heading < 0
      ? undefined
      : lines
          .slice(heading + 1)
          .find((line) => line && !line.startsWith("#"))
          ?.slice(0, 200)
  return Buffer.from(`---\ndescription: ${JSON.stringify(description ?? `Workflow: ${name}`)}\n---\n${body}\n`)
}

function recordObject(input: unknown): input is Record<string, unknown> {
  return input !== null && typeof input === "object" && !Array.isArray(input)
}

function standaloneSkill(text: string, name: string) {
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text)?.[1]
  try {
    const doc = frontmatter && Bun.YAML.parse(frontmatter)
    return (
      recordObject(doc) &&
      doc.name === name &&
      (doc.description === undefined || typeof doc.description === "string") &&
      Object.keys(doc).every((key) => key === "name" || key === "description")
    )
  } catch {
    return false // Avoid leaking manifest content into diagnostics.
  }
}

// Files with distinct paths can shadow one another by discovery ID. Include the
// preview projection here: applyConfig may not have installed its outputs yet.
function commandClaims(plan: Inventory, dir: string, stable: string, resources: Item[]) {
  const commands = new Map(
    resources.filter((item) => item.kind === "workflow").map((item) => [fold(path.basename(item.target, ".md")), item]),
  )
  if (!commands.size) return
  for (const top of ["command", "commands", "workflows"]) {
    for (const child of children(path.join(dir, top))) {
      if (!child.name.endsWith(".md")) continue
      const resource = commands.get(fold(path.basename(child.name, ".md")))
      if (!resource) continue
      const source = path.join(dir, top, child.name)
      const target = path.join(stable, top === "workflows" ? "command" : top, child.name)
      const content = top === "workflows" ? output("workflow", source) : read(source)
      if (resource.target !== target || resource.digest !== hash(content)) clash(plan, resource, source)
    }
  }
  for (const file of ["kilo.json", "kilo.jsonc", "kilo2.json", "kilo2.jsonc"].map((name) => path.join(dir, name))) {
    if (!entry(file)) continue
    for (const name of commandNames(file)) {
      const resource = commands.get(fold(name))
      if (resource) clash(plan, resource, file)
    }
  }
}

function commandNames(file: string): string[] {
  const errors: ParseError[] = []
  const tree = parseTree(read(file).toString("utf8"), errors, { allowTrailingComma: true })
  if (tree?.type !== "object" || errors.length)
    throw new Error(`Resolve invalid settings before checking workflow names in ${file}`)
  return ["command", "commands"].flatMap((key) =>
    (findNodeAtLocation(tree, [key])?.children ?? []).map((prop) => String(prop.children?.[0]?.value)),
  )
}

function skillClaims(plan: Inventory, dir: string, stable: string, resources: Item[]) {
  const manifests = new Map(
    resources
      .filter((item) => item.kind === "skill")
      .map((item) => [fold(path.basename(path.dirname(item.target))), item]),
  )
  if (!manifests.size) return
  for (const top of ["skill", "skills"]) {
    const base = path.join(dir, top)
    if (top === "skills" && entry(path.join(base, "SKILL.md"))) {
      plan.conflicts.add(
        `Relocate ${path.join(base, "SKILL.md")} before switching: a root manifest hides nested skills`,
      )
    }
    function visit(folder: string) {
      const entries = children(folder)
      for (const child of entries) {
        const file = path.join(folder, child.name)
        if (child.isSymbolicLink())
          throw new Error(`Review the linked skill entry before checking discovery names: ${file}`)
        if (child.isDirectory()) visit(file)
        if (!child.isFile()) continue
        const id =
          child.name === "SKILL.md"
            ? path.basename(folder)
            : folder === base && child.name.endsWith(".md")
              ? path.basename(child.name, ".md")
              : undefined
        const resource = id && manifests.get(fold(id))
        if (
          resource &&
          (resource.target !== path.join(stable, path.relative(dir, file)) ||
            entries.length !== 1 ||
            resource.digest !== hash(read(file)))
        )
          clash(plan, resource, file)
      }
    }
    visit(base)
    // Files with no manifest must not unexpectedly become assets of the incoming skill.
    for (const item of manifests.values()) {
      const folder = path.join(base, path.basename(path.dirname(item.target)))
      for (const child of children(folder))
        if (child.name !== "SKILL.md") clash(plan, item, path.join(folder, child.name))
    }
  }
}

function clash(plan: Inventory, item: Item, source: string) {
  plan.conflicts.add(`Reconcile ${item.kind} discovery before switching: ${item.source} conflicts with ${source}`)
}

function fold(value: string) {
  return value.normalize("NFC").toLowerCase()
}
function hash(bytes: Buffer) {
  return createHash("sha256").update(bytes).digest("hex")
}

function directory(dir: string, create = false): boolean {
  const parent = path.dirname(dir)
  if (dir !== parent && !directory(parent, create)) return false
  const stat = fs.lstatSync(dir, { throwIfNoEntry: false })
  if (stat?.isDirectory()) return true
  if (stat)
    throw new Error(`Review non-directory or linked migration path ${dir}; supply verified physical profile roots`)
  if (create) {
    fs.mkdirSync(dir, { mode: 0o700 })
    syncDirectory(parent)
  }
  return create
}

function children(dir: string) {
  return directory(dir) ? fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)) : []
}

function entry(file: string) {
  return directory(path.dirname(file)) ? fs.lstatSync(file, { throwIfNoEntry: false }) : undefined
}

function read(file: string) {
  const stat = entry(file)
  if (!stat?.isFile()) throw new Error(`Expected a regular file, not a link or special file: ${file}`)
  const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0) | (fs.constants.O_NONBLOCK ?? 0))
  try {
    const actual = fs.fstatSync(fd)
    if (!actual.isFile() || actual.dev !== stat.dev || actual.ino !== stat.ino) throw new Error(`File changed: ${file}`)
    return fs.readFileSync(fd)
  } finally {
    fs.closeSync(fd)
  }
}

function publish(item: Item) {
  if (entry(item.target)) {
    if (hash(read(item.target)) !== item.digest) throw new Error(`Target changed: ${item.target}`)
    return
  }
  const bytes = output(item.kind, item.source)
  if (hash(bytes) !== item.digest) throw new Error(`Source changed: ${item.source}`)
  const dir = path.dirname(item.target)
  directory(dir, true)
  const temp = path.join(dir, `.kilo-migrate-${randomUUID()}.tmp`)
  const fd = fs.openSync(temp, "wx", 0o600)
  try {
    fs.writeFileSync(fd, bytes)
    fs.fsyncSync(fd)
    fs.linkSync(temp, item.target) // Atomic, exclusive publication; never rename over an existing preference or prompt.
  } finally {
    fs.closeSync(fd)
    fs.unlinkSync(temp)
  }
  syncDirectory(dir)
}

function syncDirectory(dir: string) {
  // Directory handles cannot be fsynced via Node on Windows.
  if (process.platform === "win32") return
  const fd = fs.openSync(dir, fs.constants.O_RDONLY | (fs.constants.O_DIRECTORY ?? 0) | (fs.constants.O_NOFOLLOW ?? 0))
  try {
    fs.fsyncSync(fd)
  } finally {
    fs.closeSync(fd)
  }
}
