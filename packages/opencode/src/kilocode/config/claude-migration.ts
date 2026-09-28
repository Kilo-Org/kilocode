import matter from "gray-matter"
import { createHash, randomUUID } from "crypto"
import { existsSync } from "fs"
import { link, lstat, mkdir, opendir, readFile, rename, rm, writeFile } from "fs/promises"
import path from "path"
import { ConfigMCPV1 as ConfigMCP } from "@opencode-ai/core/v1/config/mcp"
import { Global } from "@opencode-ai/core/global"
import { Flag } from "@opencode-ai/core/flag/flag"
import * as Log from "@opencode-ai/core/util/log"
import { ConfigParse } from "@/config/parse"
import { ConfigMarkdown } from "@/config/markdown"
import { KilocodeConfig } from "./config"
import { BUILTIN_SKILLS } from "../skills/builtin"
import { SkillInject } from "../skills/inject"

export namespace ClaudeMigration {
  export const VERSION = 1
  export const RECEIPT = "claude-migration.json"
  export const NOTIFICATION_ID = "kilo.local.claude-migration"
  export const DOCS_URL = "https://kilo.ai/docs/getting-started/settings"

  const MAX_MARKDOWN = 1024 * 1024
  const MAX_CONFIG = 8 * 1024 * 1024
  const MAX_SKILLS = 256
  const MAX_NOTICE_ITEMS = 8
  const HANDOFF = new Set(["complete", "incomplete", "started"])
  const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
  const log = Log.create({ service: "kilocode.claude-migration" })
  const REASONS: Record<string, string> = {
    "destination-exists": "Kilo already has a destination with that name; existing content was kept.",
    "skill-name-conflict": "Kilo already has a skill with that name; existing content was kept.",
    "mcp-name-conflict": "Kilo already has an MCP server with that name; existing configuration was kept.",
    "unsupported-markdown": "it contains dynamic content outside the supported migration subset.",
    "skill-frontmatter-unsupported": "it uses frontmatter fields outside the supported migration subset.",
    "skill-frontmatter-invalid": "its frontmatter could not be parsed, even with Kilo's compatibility fallback.",
    "skill-bundle-unsupported": "it contains additional files that this migration does not copy.",
    "destination-write-failed": "Kilo could not write the destination.",
    "destination-unsafe": "the destination path was not safe to write.",
    "source-changed": "the Claude source changed during migration, so it was not copied.",
    "source-unreadable": "the Claude source could not be read.",
    "source-not-regular": "the Claude source was not a regular file or directory.",
    "source-too-large": "the Claude source exceeded the migration size limit.",
    "source-not-text": "the Claude source was not valid text.",
    "empty-source": "the Claude source was empty.",
    "skill-limit": "the skills directory exceeded the migration limit.",
    "unsafe-skill-name": "the skill name was not safe to use as a destination.",
    "unsafe-mcp-name": "the MCP server name was not safe to use as a destination.",
    "source-json-invalid": "the Claude MCP file was not valid JSON.",
    "mcp-entry-invalid": "the MCP definition was invalid.",
    "mcp-field-unsupported": "the MCP definition uses fields outside the supported migration subset.",
    "mcp-interpolation-unsupported": "the MCP definition contains dynamic interpolation.",
    "mcp-relative-path-unsupported": "the MCP definition depends on a relative command or argument.",
    "mcp-environment-invalid": "the MCP environment values were not static strings.",
    "mcp-transport-unsupported": "the MCP transport is not supported by this migration.",
    "mcp-url-invalid": "the MCP URL was not a valid HTTP(S) URL.",
    "mcp-headers-invalid": "the MCP headers were not static strings.",
    "existing-config-unreadable": "an existing Kilo configuration could not be read safely.",
    "existing-mcp-invalid": "an existing Kilo MCP configuration was invalid.",
    "existing-skills-unreadable": "an existing Kilo skill could not be read safely.",
    "skill-name-invalid": "the skill name was invalid.",
    "skill-description-invalid": "the skill description was not a string.",
    "migration-failed": "the migration stopped before this item could be completed.",
  }

  export type Roots = {
    home: string
    config: string
    state: string
  }

  export type Item = {
    category: "instructions" | "skill" | "mcp"
    name: string
    status: "imported" | "skipped" | "failed"
    destination?: string
    reason?: string
  }

  export type Receipt = {
    version: number
    status: "started" | "complete" | "incomplete"
    startedAt: string
    finishedAt?: string
    source: {
      instructions: string
      skills: string
      mcp: string
    }
    target: {
      config: string
    }
    items: Item[]
  }

  export type Result =
    | { status: "disabled" | "unsupported-context" | "no-source" }
    | { status: "already-attempted"; receipt?: Receipt }
    | { status: "complete" | "incomplete"; receipt: Receipt }

  type RecordValue = Record<string, unknown>
  type Read = { ok: true; text: string } | { ok: false; reason: string }
  type InstructionPlan = { source: string; target: string; text?: string; revision?: string; reason?: string }
  type SkillPlan = { name: string; source: string; target: string; text?: string; revision?: string; reason?: string }
  type McpPlan = { name: string; source: string; revision?: string; value?: ConfigMCP.Info; reason?: string }

  function roots(input?: Partial<Roots>): Roots {
    return {
      home: input?.home ?? Global.Path.home,
      config: input?.config ?? Global.Path.config,
      state: input?.state ?? Global.Path.state,
    }
  }

  export function receiptPath(input?: Partial<Roots>) {
    return path.join(roots(input).state, RECEIPT)
  }

  export function hasAttempt(input?: Partial<Roots>) {
    return existsSync(receiptPath(input))
  }

  export function globalHandoff(input?: Partial<Roots>) {
    return !unsupportedContext() && hasAttempt(input)
  }

  export function unsupportedContext() {
    return ["CLAUDE_CONFIG_DIR", "KILO_CONFIG_DIR", "KILO_CONFIG", "KILO_CONFIG_CONTENT"].some(
      (key) => (process.env[key] ?? "").trim() !== "",
    )
  }

  export async function readReceipt(input?: Partial<Roots>): Promise<Receipt | undefined> {
    const file = receiptPath(input)
    if (!(await Bun.file(file).exists())) return undefined
    try {
      const data = JSON.parse(await Bun.file(file).text())
      if (!record(data) || data.version !== VERSION || !HANDOFF.has(String(data.status))) return undefined
      if (typeof data.startedAt !== "string" || !Array.isArray(data.items)) return undefined
      return data as Receipt
    } catch {
      return undefined
    }
  }

  export async function notification(input?: Partial<Roots>) {
    if (unsupportedContext()) return undefined
    const file = receiptPath(input)
    if (!(await Bun.file(file).exists())) return undefined
    const receipt = await readReceipt(input)
    const status = receipt?.status === "complete" ? "complete" : "incomplete"
    const items = receipt?.items ?? []
    const imported = items.filter((item) => item.status === "imported").length
    const skipped = items.filter((item) => item.status === "skipped").length
    const failed = items.filter((item) => item.status === "failed").length
    const outcome =
      status !== "complete"
        ? failed > 0
          ? "Claude Code migration encountered failures while importing supported"
          : "Claude Code migration started but did not finish importing supported"
        : imported === 0 && skipped > 0
          ? "Claude Code migration completed without importing supported"
          : skipped > 0
            ? "Claude Code migration imported supported items with some items skipped"
            : imported > 0
              ? "Claude Code migration imported supported"
              : "Claude Code migration completed without supported items"
    const changed = items.filter((item) => item.status !== "imported")
    const details = changed.slice(0, MAX_NOTICE_ITEMS).map(describe)
    const omitted = changed.length - details.length
    return {
      id: NOTIFICATION_ID,
      title: "Claude Code configuration migration",
      message:
        `${outcome} global Claude Code configuration into Kilo ` +
        `(imported ${imported}, skipped ${skipped}, failed ${failed}). ` +
        (details.length > 0 ? `\n${details.map((item) => `- ${item}`).join("\n")}` : "") +
        (omitted > 0
          ? `\n- ${omitted} more item${omitted === 1 ? "" : "s"} omitted; see the receipt for the full list.`
          : "") +
        (changed.length > 0
          ? `\nReview the original Claude files and receipt, then merge skipped instructions or skills manually and resolve failed items; this migration runs once.\n`
          : "") +
        `Original Claude files were left unchanged. ` +
        `Imported MCP servers are disabled until you enable them. Future global changes belong in Kilo; keep the Claude files if you still use Claude Code. ` +
        `Details: ${file}`,
      action: { actionText: "Learn more", actionURL: DOCS_URL },
      showIn: ["cli", "extension"],
    }
  }

  function describe(item: Item) {
    const name = item.name.replace(/\s+/g, " ").trim().slice(0, 80) || "unnamed"
    const label =
      item.category === "instructions"
        ? "Global CLAUDE.md"
        : item.category === "skill"
          ? `Skill "${name}"`
          : `MCP server "${name}"`
    const text =
      item.category === "instructions" && item.reason === "destination-exists"
        ? `Kilo already has ${path.basename(item.destination ?? "AGENTS.md")}; existing instructions were kept.`
        : item.reason
          ? (REASONS[item.reason] ?? `migration skipped it for safety (${item.reason}).`)
          : "not imported."
    return `${label}: ${text}`
  }

  export async function run(input: { enabled?: boolean; roots?: Partial<Roots> } = {}): Promise<Result> {
    if (!(input.enabled ?? Flag.KILO_EXPERIMENTAL_CLAUDE_MIGRATION)) return { status: "disabled" }
    if (unsupportedContext()) return { status: "unsupported-context" }

    const base = roots(input.roots)
    const existing = await readReceipt(base)
    if (existing || (await Bun.file(receiptPath(base)).exists())) {
      return { status: "already-attempted", receipt: existing }
    }

    const candidates = await hasCandidates(base)
    if (!candidates) return { status: "no-source" }

    const started: Receipt = {
      version: VERSION,
      status: "started",
      startedAt: new Date().toISOString(),
      source: {
        instructions: path.join(base.home, ".claude", "CLAUDE.md"),
        skills: path.join(base.home, ".claude", "skills"),
        mcp: path.join(base.home, ".claude.json"),
      },
      target: { config: base.config },
      items: [],
    }

    await mkdir(base.state, { recursive: true, mode: 0o700 })
    try {
      await writeFile(receiptPath(base), JSON.stringify(started, null, 2), {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600,
      })
    } catch (error) {
      if (isCode(error, "EEXIST")) return { status: "already-attempted", receipt: await readReceipt(base) }
      log.warn("failed to claim Claude migration receipt", { path: receiptPath(base) })
      return {
        status: "incomplete",
        receipt: { ...started, status: "incomplete", finishedAt: new Date().toISOString() },
      }
    }

    const items: Item[] = []
    try {
      const plan = await makePlan(base)
      await applyInstructions(plan.instructions, items, base.config)
      await applySkills(plan.skills, items, base.config)
      await applyMcp(base, plan.mcp, items)
      const status: "complete" | "incomplete" = items.some((item) => item.status === "failed")
        ? "incomplete"
        : "complete"
      const receipt: Receipt = {
        ...started,
        status,
        finishedAt: new Date().toISOString(),
        items,
      }
      await writeReceipt(receipt, base)
      return { status, receipt }
    } catch (error) {
      log.error("Claude migration phase failed", { kind: error instanceof Error ? error.name : typeof error })
      const receipt: Receipt = {
        ...started,
        status: "incomplete",
        finishedAt: new Date().toISOString(),
        items: [
          ...items,
          { category: "instructions", name: "migration", status: "failed", reason: "migration-failed" },
        ],
      }
      await writeReceipt(receipt, base).catch((error) =>
        log.warn("failed to finalize Claude migration receipt", { path: receiptPath(base), error }),
      )
      return { status: "incomplete", receipt }
    }
  }

  async function hasCandidates(base: Roots) {
    const rule = await pathExists(path.join(base.home, ".claude", "CLAUDE.md"))
    const skills = await entries(path.join(base.home, ".claude", "skills"))
    if (rule || (skills.ok && skills.items.length > 0) || (!skills.ok && skills.reason !== "missing-source"))
      return true
    const mcp = path.join(base.home, ".claude.json")
    if (!(await pathExists(mcp))) return false
    const parsed = await readLimitedJson(mcp, MAX_CONFIG)
    if (!parsed.ok) return true
    return record(parsed.value) && record(parsed.value.mcpServers) && Object.keys(parsed.value.mcpServers).length > 0
  }

  async function makePlan(base: Roots) {
    const instructions = await planInstructions(base)
    const skills = await planSkills(base)
    const mcp = await planMcp(base)
    return { instructions, skills, mcp }
  }

  async function planInstructions(base: Roots) {
    const source = path.join(base.home, ".claude", "CLAUDE.md")
    if (!(await pathExists(source))) return undefined
    const target = path.join(base.config, "AGENTS.md")
    const read = await readText(source, MAX_MARKDOWN)
    if (!read.ok) return { source, target, reason: read.reason }
    if (read.text.trim() === "") return { source, target, reason: "empty-source" }
    if (unsafeMarkdown(read.text)) return { source, target, reason: "unsupported-markdown" }
    return { source, target, text: read.text, revision: hash(source, true, read.text) }
  }

  async function planSkills(base: Roots): Promise<SkillPlan[]> {
    const root = path.join(base.home, ".claude", "skills")
    const found = await entries(root)
    if (!found.ok)
      return found.reason === "missing-source"
        ? []
        : [{ name: "skills", source: root, target: root, reason: found.reason }]
    if (found.items.length > MAX_SKILLS) return [{ name: "skills", source: root, target: root, reason: "skill-limit" }]
    const reserved = await existingSkillNames(base)
    if (!reserved.ok)
      return [{ name: "skills", source: root, target: path.join(base.config, "skills"), reason: reserved.reason }]

    const plans: SkillPlan[] = []
    for (const item of found.items) {
      if (!SAFE_NAME.test(item.name) || item.kind !== "directory") {
        plans.push({
          name: item.name,
          source: path.join(root, item.name),
          target: path.join(base.config, "skills", item.name),
          reason: "unsafe-skill-name",
        })
        continue
      }
      const dir = path.join(root, item.name)
      const files = await entries(dir, 2)
      const source = path.join(dir, "SKILL.md")
      const target = path.join(base.config, "skills", item.name, "SKILL.md")
      if (reserved.names.has(item.name.toLowerCase())) {
        plans.push({ name: item.name, source, target, reason: "skill-name-conflict" })
        continue
      }
      if (!files.ok) {
        plans.push({ name: item.name, source, target, reason: files.reason })
        continue
      }
      if (files.items.some((entry) => entry.name !== "SKILL.md")) {
        plans.push({ name: item.name, source, target, reason: "skill-bundle-unsupported" })
        continue
      }
      const read = await readText(source, MAX_MARKDOWN)
      if (!read.ok) {
        plans.push({ name: item.name, source, target, reason: read.reason })
        continue
      }
      const parsed = parseSkill(read.text, item.name)
      if (!parsed.ok) {
        plans.push({ name: item.name, source, target, reason: parsed.reason })
        continue
      }
      plans.push({ name: item.name, source, target, text: parsed.text, revision: hash(source, true, read.text) })
    }
    return plans
  }

  async function planMcp(base: Roots): Promise<McpPlan[]> {
    const source = path.join(base.home, ".claude.json")
    if (!(await pathExists(source))) return []
    const read = await readText(source, MAX_CONFIG)
    if (!read.ok) return [{ name: "mcp", source, reason: read.reason }]
    let parsed: unknown
    try {
      parsed = JSON.parse(read.text)
    } catch {
      return [{ name: "mcp", source, reason: "source-json-invalid" }]
    }
    if (!record(parsed) || !record(parsed.mcpServers)) return []
    const revision = hash(source, true, read.text)
    const existing = await existingMcpNames(base)
    if (!existing.ok)
      return Object.keys(parsed.mcpServers).map((name) => ({ name, source, revision, reason: existing.reason }))
    return Object.entries(parsed.mcpServers).map(([name, value]) => {
      if (!SAFE_NAME.test(name)) return { name, source, revision, reason: "unsafe-mcp-name" }
      const converted = convertMcp(name, value)
      if (!converted.ok) return { name, source, revision, reason: converted.reason }
      if (existing.names.has(name.toLowerCase()))
        return { name, source, revision, value: converted.value, reason: "mcp-name-conflict" }
      return { name, source, revision, value: converted.value }
    })
  }

  async function applyInstructions(plan: InstructionPlan | undefined, items: Item[], root: string) {
    if (!plan) return
    if (plan.reason) {
      items.push({
        category: "instructions",
        name: "global",
        status: "skipped",
        destination: plan.target,
        reason: plan.reason,
      })
      return
    }
    if (!plan.text) {
      items.push({
        category: "instructions",
        name: "global",
        status: "failed",
        destination: plan.target,
        reason: "source-unreadable",
      })
      return
    }
    const current = await readText(plan.source, MAX_MARKDOWN)
    if (!current.ok || current.text !== plan.text || hash(plan.source, true, current.text) !== plan.revision) {
      items.push({
        category: "instructions",
        name: "global",
        status: "skipped",
        destination: plan.target,
        reason: "source-changed",
      })
      return
    }
    if (!(await safeDestination(plan.target, root))) {
      items.push({
        category: "instructions",
        name: "global",
        status: "skipped",
        destination: plan.target,
        reason: "destination-unsafe",
      })
      return
    }
    if (await pathExists(plan.target)) {
      items.push({
        category: "instructions",
        name: "global",
        status: "skipped",
        destination: plan.target,
        reason: "destination-exists",
      })
      return
    }
    try {
      await writeNew(plan.target, plan.text, root)
      items.push({ category: "instructions", name: "global", status: "imported", destination: plan.target })
    } catch {
      items.push({
        category: "instructions",
        name: "global",
        status: "failed",
        destination: plan.target,
        reason: "destination-write-failed",
      })
    }
  }

  async function applySkills(plans: SkillPlan[], items: Item[], root: string) {
    for (const plan of plans) {
      if (plan.reason) {
        items.push({
          category: "skill",
          name: plan.name,
          status: "skipped",
          destination: plan.target,
          reason: plan.reason,
        })
        continue
      }
      if (!plan.text) {
        items.push({
          category: "skill",
          name: plan.name,
          status: "failed",
          destination: plan.target,
          reason: "source-unreadable",
        })
        continue
      }
      const current = await readText(plan.source, MAX_MARKDOWN)
      if (!current.ok || hash(plan.source, true, current.text) !== plan.revision) {
        items.push({
          category: "skill",
          name: plan.name,
          status: "skipped",
          destination: plan.target,
          reason: "source-changed",
        })
        continue
      }
      if (!(await safeDestination(plan.target, root))) {
        items.push({
          category: "skill",
          name: plan.name,
          status: "skipped",
          destination: plan.target,
          reason: "destination-unsafe",
        })
        continue
      }
      if (await pathExists(plan.target)) {
        items.push({
          category: "skill",
          name: plan.name,
          status: "skipped",
          destination: plan.target,
          reason: "destination-exists",
        })
        continue
      }
      try {
        await writeNew(plan.target, plan.text, root)
        items.push({ category: "skill", name: plan.name, status: "imported", destination: plan.target })
      } catch {
        items.push({
          category: "skill",
          name: plan.name,
          status: "failed",
          destination: plan.target,
          reason: "destination-write-failed",
        })
      }
    }
  }

  async function applyMcp(base: Roots, plans: McpPlan[], items: Item[]) {
    const additions = Object.fromEntries(
      plans.filter((plan) => plan.value && !plan.reason).map((plan) => [plan.name, plan.value]),
    ) as Record<string, ConfigMCP.Info>
    for (const plan of plans) {
      if (plan.reason) {
        items.push({ category: "mcp", name: plan.name, status: "skipped", reason: plan.reason })
      }
    }
    if (Object.keys(additions).length === 0) return

    const source = plans.find((plan) => plan.revision !== undefined)
    if (source) {
      const current = await readText(source.source, MAX_CONFIG)
      if (!current.ok || hash(source.source, true, current.text) !== source.revision) {
        for (const name of Object.keys(additions))
          items.push({ category: "mcp", name, status: "skipped", reason: "source-changed" })
        return
      }
    }

    if (!(await writeMcp(base, additions))) {
      for (const name of Object.keys(additions)) {
        items.push({ category: "mcp", name, status: "failed", reason: "destination-write-failed" })
      }
      return
    }
    for (const name of Object.keys(additions)) items.push({ category: "mcp", name, status: "imported" })
  }

  async function writeMcp(base: Roots, additions: Record<string, ConfigMCP.Info>) {
    const target = await globalTarget(base.config)
    if (!target.safe) return false
    if (!(await safeDestination(target.path, base.config))) return false
    const before = target.exists ? await readFile(target.path, "utf8") : "{}"
    const revision = hash(target.path, target.exists, target.exists ? before : "")
    try {
      const current = target.exists ? await readFile(target.path, "utf8") : "{}"
      if (hash(target.path, target.exists, target.exists ? current : "") !== revision) return false
      const { KilocodeConfigWriter } = await import("./writer")
      const result = await KilocodeConfigWriter.write({
        directory: base.home,
        scope: "global",
        expected: { path: target.path, revision },
        set: { mcp: additions },
      })
      if (!result.ok) log.warn("MCP configuration write was rejected", { code: result.code })
      return result.ok
    } catch {
      log.warn("failed to write imported MCP configuration", { path: target.path })
      return false
    }
  }

  async function globalTarget(config: string) {
    const names = ["kilo.jsonc", "kilo.json", "opencode.jsonc", "opencode.json", "config.json"]
    for (const name of names) {
      const file = path.join(config, name)
      if (!(await pathExists(file))) continue
      const info = await lstat(file)
      return { path: file, exists: true, safe: info.isFile() && !info.isSymbolicLink() }
    }
    return { path: path.join(config, names[0]), exists: false, safe: true }
  }

  function hash(file: string, exists: boolean, text: string) {
    return createHash("sha256")
      .update(file)
      .update("\0")
      .update(exists ? "exists" : "missing")
      .update("\0")
      .update(text)
      .digest("hex")
  }

  async function existingMcpNames(
    base: Roots,
  ): Promise<{ ok: true; names: Set<string> } | { ok: false; reason: string }> {
    const dirs = [base.config, path.join(base.home, ".kilo"), path.join(base.home, ".kilocode")]
    const names = new Set<string>()
    for (const dir of dirs) {
      for (const file of KilocodeConfig.GLOBAL_CONFIG_FILES) {
        const filepath = path.join(dir, file)
        if (!(await fileExists(filepath))) continue
        const text = await readText(filepath, MAX_CONFIG)
        if (!text.ok) return { ok: false, reason: "existing-config-unreadable" }
        let parsed: unknown
        try {
          parsed = ConfigParse.jsonc(text.text, filepath)
        } catch {
          return { ok: false, reason: "existing-config-unreadable" }
        }
        if (!record(parsed)) continue
        if (parsed.mcp !== undefined && !record(parsed.mcp)) return { ok: false, reason: "existing-mcp-invalid" }
        if (record(parsed.mcp)) {
          for (const name of Object.keys(parsed.mcp)) names.add(name.toLowerCase())
        }
      }
    }
    return { ok: true, names }
  }

  async function existingSkillNames(
    base: Roots,
  ): Promise<{ ok: true; names: Set<string> } | { ok: false; reason: string }> {
    const names = new Set(BUILTIN_SKILLS.map((item) => item.name.toLowerCase()))
    for (const name of ["init", "review", "resume-claude", "resume-codex"]) names.add(name)
    const dirs = [
      path.join(base.config, "skills"),
      path.join(base.home, ".kilo", "skills"),
      path.join(base.home, ".kilocode", "skills"),
      path.join(base.home, ".agents", "skills"),
    ]
    for (const dir of dirs) {
      const found = await entries(dir)
      if (!found.ok) {
        if (found.reason === "missing-source") continue
        return { ok: false, reason: "existing-skills-unreadable" }
      }
      for (const item of found.items) {
        if (item.kind !== "directory") continue
        names.add(item.name.toLowerCase())
        const read = await readText(path.join(dir, item.name, "SKILL.md"), MAX_MARKDOWN)
        if (!read.ok) {
          if (read.reason === "missing-source") continue
          return { ok: false, reason: "existing-skills-unreadable" }
        }
        try {
          const data = matter(read.text).data
          if (record(data) && typeof data.name === "string") names.add(data.name.toLowerCase())
        } catch {
          return { ok: false, reason: "existing-skills-unreadable" }
        }
      }
    }

    for (const dir of [base.config, path.join(base.home, ".kilo"), path.join(base.home, ".kilocode")]) {
      for (const file of KilocodeConfig.GLOBAL_CONFIG_FILES) {
        const filepath = path.join(dir, file)
        if (!(await fileExists(filepath))) continue
        const read = await readText(filepath, MAX_CONFIG)
        if (!read.ok) return { ok: false, reason: "existing-config-unreadable" }
        let parsed: unknown
        try {
          parsed = ConfigParse.jsonc(read.text, filepath)
        } catch {
          return { ok: false, reason: "existing-config-unreadable" }
        }
        if (record(parsed) && record(parsed.command)) {
          for (const name of Object.keys(parsed.command)) names.add(name.toLowerCase())
        }
      }
    }
    return { ok: true, names }
  }

  function convertMcp(
    name: string,
    value: unknown,
  ): { ok: true; value: ConfigMCP.Info } | { ok: false; reason: string } {
    if (!record(value)) return { ok: false, reason: "mcp-entry-invalid" }
    if (hasInterpolation(value)) {
      return { ok: false, reason: "mcp-interpolation-unsupported" }
    }
    const type = value.type
    if (type === undefined || type === "stdio") {
      const command = value.command
      const args = value.args
      const env = value.env
      if (typeof command !== "string" || command.length === 0 || (args !== undefined && !stringArray(args))) {
        return { ok: false, reason: "mcp-entry-invalid" }
      }
      if (command.startsWith(".") || (stringArray(args) && args.some((item) => item.startsWith(".")))) {
        return { ok: false, reason: "mcp-relative-path-unsupported" }
      }
      if (env !== undefined && !stringRecord(env)) return { ok: false, reason: "mcp-environment-invalid" }
      if (!keys(value, ["type", "command", "args", "env", "disabled"]))
        return { ok: false, reason: "mcp-field-unsupported" }
      const candidate = {
        type: "local" as const,
        command: [command, ...((args as string[] | undefined) ?? [])],
        ...(env && { environment: env as Record<string, string> }),
        enabled: false,
      }
      try {
        return { ok: true, value: ConfigParse.schema(ConfigMCP.Info, candidate, `Claude MCP ${name}`) }
      } catch {
        return { ok: false, reason: "mcp-entry-invalid" }
      }
    }
    if (type !== "http" && type !== "streamable-http" && type !== "sse") {
      return { ok: false, reason: "mcp-transport-unsupported" }
    }
    if (typeof value.url !== "string" || !/^https?:\/\//.test(value.url))
      return { ok: false, reason: "mcp-url-invalid" }
    if (value.headers !== undefined && !stringRecord(value.headers)) return { ok: false, reason: "mcp-headers-invalid" }
    if (!keys(value, ["type", "url", "headers", "disabled"])) return { ok: false, reason: "mcp-field-unsupported" }
    const candidate = {
      type: "remote" as const,
      url: value.url,
      ...(value.headers && { headers: value.headers as Record<string, string> }),
      enabled: false,
      oauth: false as const,
    }
    try {
      return { ok: true, value: ConfigParse.schema(ConfigMCP.Info, candidate, `Claude MCP ${name}`) }
    } catch {
      return { ok: false, reason: "mcp-entry-invalid" }
    }
  }

  function parseSkill(text: string, name: string): { ok: true; text: string } | { ok: false; reason: string } {
    let parsed: matter.GrayMatterFile<string>
    try {
      parsed = matter(text)
    } catch {
      try {
        parsed = matter(ConfigMarkdown.fallbackSanitization(text))
      } catch {
        return { ok: false, reason: "skill-frontmatter-invalid" }
      }
    }
    if (!record(parsed.data) || !keys(parsed.data, ["name", "description", "license", "compatibility", "metadata"]))
      return { ok: false, reason: "skill-frontmatter-unsupported" }
    if (parsed.data.name !== undefined && typeof parsed.data.name !== "string")
      return { ok: false, reason: "skill-name-invalid" }
    if (parsed.data.description !== undefined && typeof parsed.data.description !== "string") {
      return { ok: false, reason: "skill-description-invalid" }
    }
    if (parsed.data.license !== undefined && typeof parsed.data.license !== "string")
      return { ok: false, reason: "skill-frontmatter-unsupported" }
    if (parsed.data.compatibility !== undefined && typeof parsed.data.compatibility !== "string")
      return { ok: false, reason: "skill-frontmatter-unsupported" }
    if (parsed.data.metadata !== undefined && !stringRecord(parsed.data.metadata))
      return { ok: false, reason: "skill-frontmatter-unsupported" }
    if (parsed.content.trim() === "" || unsafeSkillMarkdown(parsed.content))
      return { ok: false, reason: "unsupported-markdown" }
    if (parsed.data.name !== undefined && parsed.data.name.trim() === "")
      return { ok: false, reason: "skill-name-invalid" }
    const description = typeof parsed.data.description === "string" ? parsed.data.description : undefined
    const license = typeof parsed.data.license === "string" ? parsed.data.license : undefined
    const compatibility = typeof parsed.data.compatibility === "string" ? parsed.data.compatibility : undefined
    const metadata = stringRecord(parsed.data.metadata) ? parsed.data.metadata : undefined
    const frontmatter = [
      "---",
      `name: ${JSON.stringify(name)}`,
      ...(description !== undefined ? [`description: ${JSON.stringify(description)}`] : []),
      ...(license !== undefined ? [`license: ${JSON.stringify(license)}`] : []),
      ...(compatibility !== undefined ? [`compatibility: ${JSON.stringify(compatibility)}`] : []),
      ...(metadata !== undefined ? [`metadata: ${JSON.stringify(metadata)}`] : []),
      "---",
      "",
    ].join("\n")
    return { ok: true, text: frontmatter + parsed.content }
  }

  function unsafeMarkdown(text: string) {
    return (
      dynamicFiles(text) ||
      SkillInject.hasLiveShell(text) ||
      active(text, /\{(?:env|file):[^}]+\}/g) ||
      text.includes("\0")
    )
  }

  function unsafeSkillMarkdown(text: string) {
    return (
      unsafeMarkdown(text) ||
      active(text, /\$(?:ARGUMENTS(?:\[[^\]]+\])?|\d+)(?![A-Za-z0-9_])/g) ||
      active(text, /\$\{[^}]+\}/g)
    )
  }

  function active(text: string, pattern: RegExp) {
    return Array.from(text.matchAll(pattern)).some((match) => !commented(text, match.index ?? 0))
  }

  function commented(text: string, index: number) {
    const start = text.lastIndexOf("\n", index - 1) + 1
    return text.slice(start, index).trimStart().startsWith("//")
  }

  function dynamicFiles(text: string) {
    return ConfigMarkdown.files(text).some((match) => !packageReference(match[0]))
  }

  function packageReference(value: string) {
    return /^@[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9_-]*(?:\/[A-Za-z0-9][A-Za-z0-9_-]*)*$/.test(value)
  }

  function keys(value: RecordValue, allowed: string[]) {
    const set = new Set(allowed)
    return Object.keys(value).every((key) => set.has(key))
  }

  function record(value: unknown): value is RecordValue {
    return typeof value === "object" && value !== null && !Array.isArray(value)
  }

  function stringArray(value: unknown): value is string[] {
    return Array.isArray(value) && value.every((item) => typeof item === "string")
  }

  function stringRecord(value: unknown): value is Record<string, string> {
    return record(value) && Object.values(value).every((item) => typeof item === "string")
  }

  function hasInterpolation(value: unknown): boolean {
    if (typeof value === "string") return /\$\{[^}]+\}|\{(?:env|file):[^}]+\}/.test(value)
    if (Array.isArray(value)) return value.some(hasInterpolation)
    return record(value) && Object.values(value).some(hasInterpolation)
  }

  function isCode(error: unknown, code: string): boolean {
    return typeof error === "object" && error !== null && "code" in error && error.code === code
  }

  async function fileExists(file: string) {
    try {
      const info = await lstat(file)
      return info.isFile()
    } catch {
      return false
    }
  }

  async function pathExists(file: string) {
    try {
      await lstat(file)
      return true
    } catch {
      return false
    }
  }

  async function entries(
    dir: string,
    limit = MAX_SKILLS + 1,
  ): Promise<{ ok: true; items: Array<{ name: string; kind: "file" | "directory" }> } | { ok: false; reason: string }> {
    try {
      const info = await lstat(dir)
      if (!info.isDirectory() || info.isSymbolicLink()) return { ok: false, reason: "source-not-regular" }
      const handle = await opendir(dir)
      const list: Array<{ name: string; kind: "file" | "directory" }> = []
      for await (const item of handle) {
        if (list.length >= limit) break
        list.push({ name: item.name, kind: item.isDirectory() ? "directory" : "file" })
      }
      return {
        ok: true,
        items: list,
      }
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
        return { ok: false, reason: "missing-source" }
      }
      return { ok: false, reason: "source-unreadable" }
    }
  }

  async function readText(file: string, limit: number): Promise<Read> {
    try {
      const info = await lstat(file)
      if (!info.isFile() || info.isSymbolicLink()) return { ok: false, reason: "source-not-regular" }
      if (info.size > limit) return { ok: false, reason: "source-too-large" }
      const bytes = await readFile(file)
      const text = bytes.toString("utf8")
      if (!Buffer.from(text, "utf8").equals(bytes)) return { ok: false, reason: "source-not-text" }
      return { ok: true, text }
    } catch {
      return { ok: false, reason: "source-unreadable" }
    }
  }

  async function readLimitedJson(
    file: string,
    limit: number,
  ): Promise<{ ok: true; value: unknown } | { ok: false; reason: string }> {
    const read = await readText(file, limit)
    if (!read.ok) return read
    try {
      return { ok: true, value: JSON.parse(read.text) }
    } catch {
      return { ok: false, reason: "source-json-invalid" }
    }
  }

  async function writeNew(file: string, text: string, root: string) {
    if (!(await safeDestination(file, root))) throw new Error("unsafe migration destination")
    await mkdir(path.dirname(file), { recursive: true, mode: 0o700 })
    const temp = `${file}.${process.pid}.${randomUUID()}.tmp`
    try {
      await writeFile(temp, text, { encoding: "utf8", flag: "wx", mode: 0o600 })
      await link(temp, file)
    } finally {
      await rm(temp, { force: true }).catch((error) =>
        log.warn("failed to remove migration temporary file", { temp, error }),
      )
    }
  }

  async function writeReceipt(receipt: Receipt, base: Roots) {
    const file = receiptPath(base)
    const temp = `${file}.${process.pid}.${randomUUID()}.tmp`
    try {
      await writeFile(temp, JSON.stringify(receipt, null, 2), { encoding: "utf8", flag: "wx", mode: 0o600 })
      await rename(temp, file)
    } finally {
      await rm(temp, { force: true }).catch((error) =>
        log.warn("failed to remove migration receipt temporary file", { temp, error }),
      )
    }
  }

  async function safeDestination(file: string, root: string) {
    const destination = path.resolve(file)
    const boundary = path.resolve(root)
    const relative = path.relative(boundary, destination)
    if (relative === "" || path.isAbsolute(relative) || relative.split(path.sep)[0] === "..") return false

    let current = path.parse(destination).root
    for (const part of path.dirname(destination).slice(current.length).split(path.sep).filter(Boolean)) {
      current = path.join(current, part)
      try {
        const info = await lstat(current)
        if (info.isSymbolicLink() || !info.isDirectory()) return false
      } catch (error) {
        if (isCode(error, "ENOENT")) return true
        return false
      }
    }
    return true
  }
}
