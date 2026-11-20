import { ConfigNormalize } from "@opencode/core/config/normalize"
import { KiloConfigPolicy } from "@opencode/core/kilocode/config/policy"
import { getNodeValue, parseTree, type Node, type ParseError } from "jsonc-parser"
import { createHash, randomUUID } from "node:crypto"
import fs from "node:fs"
import path from "node:path"

type File = { source: string; target: string; digest: string; executable: boolean; workflow: boolean }
export type ConfigPlan = {
  legacyDir: string
  legacyDefaultDir: string
  previewDir: string
  conflicts: string[]
  skipped: string[]
  files: File[]
  explicit?: { file: string; digest: string }
}

const configName = /^kilo2?\.jsonc?$/
const trees = new Set([
  "skill",
  "skills",
  "agent",
  "agents",
  "mode",
  "modes",
  "command",
  "commands",
  "workflows",
  "themes",
])
const credentialFile =
  /^(?:\.env(?:\..*)?|\.(?:npmrc|netrc|ssh|aws|gnupg)|(?:.*[-_.])?(?:auth|credentials?|secrets?|tokens?|passwords?)(?:\.(?:jsonc?|ya?ml|env|toml|txt|db))?|id_(?:rsa|ed25519)(?:\..*)?|.*\.(?:pem|key|p12|pfx))$/i
const stagingName = /^\.kilo-migrate-[0-9a-f-]{36}\.tmp$/
const generated = new Set([
  ".gitignore",
  ".DS_Store",
  "node_modules",
  "bun.lock",
  "bun.lockb",
  "package.json",
  "package-lock.json",
])

// Only the supplied global config roots. Home dot-directories, editor globalStorage,
// project/managed config, XDG state/model.json and credential stores have separate owners.
export function planConfig(
  legacyDir: string,
  previewDir: string,
  explicitFile?: string,
  legacyDefaultDir = legacyDir,
): ConfigPlan {
  const stable = path.resolve(legacyDir)
  const preview = path.resolve(previewDir)
  const plan: ConfigPlan = {
    legacyDir: stable,
    legacyDefaultDir: path.resolve(legacyDefaultDir),
    previewDir: preview,
    conflicts: [],
    skipped: [],
    files: [],
  }
  const claims = new Map<string, string>()
  const docs: { scope: string; target: string; digest: string; keys: string[] }[] = []

  function claim(id: string, file: string) {
    const prior = claims.get(id)
    if (prior && prior !== file) plan.conflicts.push(`Both ${prior} and ${file} define ${id}`)
    claims.set(id, file)
  }

  function record(root: string, relative: string) {
    const parts = relative.split(path.sep)
    const top = parts[0]!
    const source = path.join(root, relative)
    const workflow = top === "workflows"
    const target = configName.test(top)
      ? top.replace("kilo2", "kilo")
      : path.join(workflow ? "command" : top, ...parts.slice(1))
    const absolute = path.join(stable, target)
    const content = read(source)
    const bytes = workflow ? command(content.bytes, source) : content.bytes
    const digest = hash(bytes)
    if (configName.test(top) || top === "cli.json" || top === "themes") {
      const doc = document(bytes.toString("utf8"), source, absolute)
      if (configName.test(top)) {
        const effective = settings(doc, source)
        docs.push({
          scope: path.join(root, top.split(".")[0]!),
          target,
          digest,
          keys: Object.keys(effective).filter((key) => key !== "$schema"),
        })
        for (const name of Object.keys(effective.agents ?? {})) claim(`agent:${name}`, target)
        for (const name of Object.keys(effective.commands ?? {})) claim(`command:${name}`, target)
      }
    }
    const id = discovery(parts, source, absolute, bytes)
    if (id) claim(id, target)
    plan.files.push({ source, target: absolute, digest, executable: content.executable, workflow })
  }

  function visit(root: string, relative: string) {
    const file = path.join(root, relative)
    const top = relative.split(path.sep)[0]!
    const name = path.basename(file)
    if (credentialFile.test(name) || stagingName.test(name) || (relative === name && generated.has(name))) {
      plan.skipped.push(`${file}: credential or generated dependency; left in place`)
      return
    }
    try {
      const stat = fs.lstatSync(file)
      if (stat.isSymbolicLink()) throw new Error(`Symbolic link requires manual review: ${file}`)
      if (top === "plugin" || top === "plugins") {
        if (!stat.isDirectory() || fs.readdirSync(file).length)
          throw new Error(`Review plugin API compatibility before switching: ${file}`)
        return
      }
      if (trees.has(top) && stat.isDirectory()) {
        for (const child of fs.readdirSync(file).sort()) visit(root, path.join(relative, child))
        return
      }
      if (!supported(relative) || !stat.isFile()) throw new Error(`Manual configuration review required: ${file}`)
      record(root, relative)
    } catch (error) {
      plan.conflicts.push(message(error))
    }
  }

  try {
    if (explicitFile) {
      const { bytes } = read(explicitFile)
      settings(document(bytes.toString("utf8"), explicitFile, explicitFile), explicitFile)
      plan.explicit = { file: explicitFile, digest: hash(bytes) }
    }
    for (const root of configRoots(plan)) {
      if (!directory(root)) continue
      for (const name of fs.readdirSync(root).sort()) {
        if (path.join(root, name) === explicitFile && !supported(name)) continue
        visit(root, name)
      }
    }
    // A .jsonc can shadow a .json even though neither file collides on disk. Keep a
    // precedence pair from the same input profile, including on a partially applied retry.
    for (const left of docs) {
      for (const right of docs.filter((item) => item.target > left.target)) {
        const samePair = docs.some(
          (a) =>
            a.digest === left.digest &&
            a.target === left.target &&
            docs.some((b) => b.scope === a.scope && b.target === right.target && b.digest === right.digest),
        )
        if (!samePair && left.keys.some((key) => right.keys.includes(key)))
          plan.conflicts.push(`Review settings precedence between ${left.scope} and ${right.scope}`)
      }
    }
    checkTargets(plan)
  } catch (error) {
    plan.conflicts.push(message(error))
  }
  plan.conflicts = [...new Set(plan.conflicts)].sort()
  return plan
}

function configRoots(plan: ConfigPlan) {
  const stableRoots = [...new Set([plan.legacyDir, plan.legacyDefaultDir])]
  const roots = [...stableRoots, plan.previewDir]
  for (const [i, root] of roots.entries()) {
    for (const other of roots.slice(i + 1)) {
      if (root === other || root.startsWith(other + path.sep) || other.startsWith(root + path.sep))
        throw new Error(`Configuration roots must be distinct and not nested: ${root} and ${other}`)
    }
  }
  return roots
}

function settings(input: Record<string, unknown>, file: string) {
  // Use the same normalization as discovery, without resolving variables or loading any plugin.
  const normalized = ConfigNormalize.normalize(KiloConfigPolicy.normalize(input))
  const issues = [...normalized.diagnostics]
  const info =
    normalized.type === "normalized" && KiloConfigPolicy.parse(input, normalized.encoded, (issue) => issues.push(issue))
  if (!info || issues.length)
    throw new Error(
      `Runtime would ignore or replace settings in ${file}; review ${issues.map((issue) => issue.path[0]).join(", ") || "root"}`,
    )
  return info
}

function supported(relative: string) {
  const [top, ...tail] = relative.split(path.sep)
  if (!tail.length) return configName.test(relative) || relative === "AGENTS.md" || relative === "cli.json"
  if (top === "themes") return tail.length === 1 && relative.endsWith(".json")
  // Don't recursively import arbitrary hidden files, keys, databases or credential JSON
  // from a skill bundle. Other assets stay in place and require an explicit review.
  if (top === "skill" || top === "skills")
    return !tail.some((part) => part.startsWith(".")) && /\.(?:md|py|sh|bash|ps1|m?js|ts)$/.test(relative)
  if (!relative.endsWith(".md")) return false
  if (top === "mode" || top === "modes" || top === "workflows") return tail.length === 1
  return top === "agent" || top === "agents" || top === "command" || top === "commands"
}

function discovery(parts: string[], file: string, target: string, bytes: Buffer) {
  const [top, ...tail] = parts
  if (!top || !trees.has(top) || !file.endsWith(".md")) return
  const text = bytes.toString("utf8")
  if (file !== target && /\]\(<?(?!https?:|\/|#|~\/|mailto:)[^\s)]+/i.test(text))
    throw new Error(`Relative Markdown link may change base; review ${file}`)
  if (top === "skill" || top === "skills") return skillId(tail, file, text)
  if (/\{(?:file|env):/.test(text)) throw new Error(`Markdown substitution requires manual review: ${file}`)
  const name = tail.join("/").slice(0, -3)
  const declared = frontmatter(text, file)?.name
  if (declared !== undefined && declared !== name) throw new Error(`Markdown name and discovery path differ: ${file}`)
  return `${top.startsWith("command") || top === "workflows" ? "command" : "agent"}:${name}`
}

function skillId(parts: string[], file: string, text: string) {
  if (parts.at(-1) !== "SKILL.md") return parts.length === 1 ? `skill:${path.basename(file, ".md")}` : undefined
  if (parts.length < 2 || parts.length > 7 || parts.some((part) => part.startsWith(".")))
    throw new Error(`Skill outside discoverable layout: ${file}`)
  const id = parts.at(-2)!
  const name = frontmatter(text, file)?.name
  if (name !== undefined && name !== id) throw new Error(`Skill name and discovery directory differ: ${file}`)
  return `skill:${id}`
}

function frontmatter(text: string, file: string): Record<string, unknown> | undefined {
  if (!text.startsWith("---")) return
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text)
  if (match) {
    try {
      const data: unknown = Bun.YAML.parse(match[1]!)
      if (data && typeof data === "object" && !Array.isArray(data)) return data as Record<string, unknown>
    } catch {
      // YAML parse errors may contain private file contents.
    }
  }
  throw new Error(`Invalid or unsupported Markdown frontmatter: ${file}`)
}

function command(bytes: Buffer, file: string) {
  const body = bytes.toString("utf8").trim()
  const lines = body.split(/\r?\n/).map((line) => line.trim())
  const heading = lines.findIndex((line) => line.startsWith("#"))
  const description =
    heading < 0
      ? undefined
      : lines
          .slice(heading + 1)
          .find((line) => line && !line.startsWith("#"))
          ?.slice(0, 200)
  return Buffer.from(
    `---\ndescription: ${JSON.stringify(description ?? `Workflow: ${path.basename(file, ".md")}`)}\n---\n${body}\n`,
  )
}

function document(text: string, file: string, target: string) {
  const errors: ParseError[] = []
  const tree = parseTree(text, errors, { allowTrailingComma: true })
  if (errors.length || tree?.type !== "object") throw new Error(`Invalid JSON/JSONC object: ${file}`)
  inspect(tree, [], file, target)
  const doc: Record<string, unknown> = getNodeValue(tree)
  for (const key of ["plugin", "plugins"]) {
    if (key in doc && !(Array.isArray(doc[key]) && !doc[key].length))
      throw new Error(`Review ${key} compatibility before switching: ${file}`)
  }
  return doc
}

function inspect(node: Node, keys: string[], file: string, target: string) {
  if (node.type === "object") {
    const seen = new Set<string>()
    for (const property of node.children ?? []) {
      const key: string = property.children![0]!.value
      if (seen.has(key)) throw new Error(`Duplicate JSON property in ${file}`)
      seen.add(key)
      inspect(property.children![1]!, [...keys, key], file, target)
    }
    return
  }
  if (node.type === "array") {
    for (const child of node.children ?? []) inspect(child, keys, file, target)
    return
  }
  if (file === target || node.type !== "string") return
  const value: string = node.value
  if (
    keys.some((key) =>
      /(?:api.?key|token|secret|password|authorization|cookie|credential|private.?key|^headers$|^environment$)/i.test(
        key,
      ),
    ) &&
    !/^(?:Bearer )?\{(?:env|file):[^}]+\}$/.test(value)
  )
    throw new Error(`Inline credential or literal header/environment value; review ${file}`)
  if (path.dirname(file) === path.dirname(target)) return
  const references = [...value.matchAll(/\{file:([^}]+)\}/g)].map((match) => match[1]!)
  if (keys.some((key) => /^(?:instructions|skills|cwd|path|paths|directory|writable_paths)$/.test(key)))
    references.push(value)
  if (
    references.some((ref) => !path.isAbsolute(ref) && !ref.startsWith("~/") && !/^https?:\/\//.test(ref)) ||
    /^(?:\.\.?[/\\]|file:)/.test(value)
  )
    throw new Error(`Relative path may change base; review ${file}`)
}

function checkTargets(plan: ConfigPlan) {
  const targets = new Map<string, File>()
  for (const file of plan.files) {
    const key = file.target.normalize("NFC").toLowerCase()
    const prior = targets.get(key)
    if (prior && (prior.target !== file.target || prior.digest !== file.digest || prior.executable !== file.executable))
      plan.conflicts.push(`Different files would occupy ${file.target}: ${prior.source} and ${file.source}`)
    targets.set(key, file)
    directory(path.dirname(file.target))
    const stat = fs.lstatSync(file.target, { throwIfNoEntry: false })
    if (stat && !stat.isFile()) plan.conflicts.push(`Target is not a regular file: ${file.target}`)
  }
  for (const key of targets.keys()) {
    for (let parent = path.dirname(key); parent !== path.dirname(parent); parent = path.dirname(parent)) {
      if (targets.has(parent)) plan.conflicts.push(`File/directory collision: ${targets.get(parent)!.target}`)
    }
  }
}

function directory(dir: string, create = false): boolean {
  const parent = path.dirname(dir)
  if (parent !== dir && !directory(parent, create)) return false
  const stat = fs.lstatSync(dir, { throwIfNoEntry: false })
  if (stat?.isDirectory()) return true
  if (stat)
    throw new Error(
      `Expected a directory, not a file or symbolic link: ${dir}. Supply a verified physical configuration path.`,
    )
  if (create) {
    fs.mkdirSync(dir, { mode: 0o700 })
    syncDirectory(parent)
  }
  return create
}

function read(file: string) {
  directory(path.dirname(file))
  const stat = fs.lstatSync(file)
  if (!stat.isFile()) throw new Error(`Expected a regular file: ${file}`)
  const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0) | (fs.constants.O_NONBLOCK ?? 0))
  try {
    const opened = fs.fstatSync(fd)
    if (!opened.isFile() || opened.dev !== stat.dev || opened.ino !== stat.ino) throw new Error(`File changed: ${file}`)
    return { bytes: fs.readFileSync(fd), executable: !!(opened.mode & 0o100) }
  } finally {
    fs.closeSync(fd)
  }
}

function hash(bytes: Buffer) {
  return createHash("sha256").update(bytes).digest("hex")
}

function message(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function checked(plan: ConfigPlan) {
  if (plan.conflicts.length) throw new Error(plan.conflicts.join("\n"))
  return [...new Set(plan.files.map((file) => JSON.stringify([file.target, file.digest, file.executable])))]
    .sort()
    .join("\n")
}

/** Apply only an unchanged, conflict-free inventory. link() publishes complete files exclusively;
 * a failed/interrupted run can reuse matching files. Existing files are never replaced. */
export function applyConfig(plan: ConfigPlan) {
  const expected = checked(plan)
  const fresh = planConfig(plan.legacyDir, plan.previewDir, plan.explicit?.file, plan.legacyDefaultDir)
  if (expected !== checked(fresh) || plan.explicit?.digest !== fresh.explicit?.digest)
    throw new Error("Configuration changed after planning; repeat preflight")
  for (const file of fresh.files) {
    directory(path.dirname(file.target), true)
    if (fs.lstatSync(file.target, { throwIfNoEntry: false })) {
      const existing = read(file.target)
      if (hash(existing.bytes) !== file.digest || existing.executable !== file.executable)
        throw new Error(`Target changed: ${file.target}`)
      continue
    }
    const input = read(file.source)
    const bytes = file.workflow ? command(input.bytes, file.source) : input.bytes
    if (hash(bytes) !== file.digest || input.executable !== file.executable)
      throw new Error(`Source changed: ${file.source}`)
    const temp = path.join(path.dirname(file.target), `.kilo-migrate-${randomUUID()}.tmp`)
    const fd = fs.openSync(temp, "wx", file.executable ? 0o700 : 0o600)
    try {
      fs.writeFileSync(fd, bytes)
      fs.fsyncSync(fd)
      fs.linkSync(temp, file.target)
    } finally {
      fs.closeSync(fd)
      fs.unlinkSync(temp)
    }
    syncDirectory(path.dirname(file.target))
  }
}

function syncDirectory(dir: string) {
  if (process.platform === "win32") return
  const fd = fs.openSync(dir, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW)
  try {
    fs.fsyncSync(fd)
  } finally {
    fs.closeSync(fd)
  }
}
