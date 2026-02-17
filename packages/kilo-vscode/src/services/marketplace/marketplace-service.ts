import os from "node:os"
import path from "node:path"
import fs from "node:fs/promises"
import { createReadStream, existsSync } from "node:fs"
import { pipeline } from "node:stream/promises"
import zlib from "node:zlib"
import * as YAML from "yaml"
import * as vscode from "vscode"
import * as tarFs from "tar-fs"
import type {
  MarketplaceCatalogResult,
  MarketplaceInstallOptions,
  MarketplaceInstalledMetadata,
  MarketplaceItem,
  MarketplaceItemType,
  MarketplaceMcpInstallMethod,
  MarketplaceSkillItem,
} from "./types"
import {
  marketplaceItemSchema,
  mcpMarketplaceCatalogSchema,
  modeMarketplaceCatalogSchema,
  skillsMarketplaceCatalogSchema,
} from "./schema"

const CACHE_TTL_MS = 5 * 60_000
const MARKETPLACE_FETCH_RETRIES = 3
const MARKETPLACE_FETCH_TIMEOUT_MS = 12_000
const MARKETPLACE_RETRY_BASE_DELAY_MS = 500
const DEFAULT_BACKEND_BASE_URL = "https://kilo.ai"
const DEFAULT_API_BASE_URL = "https://api.kilo.ai"
const SAFE_MARKETPLACE_ID_PATTERN = /^[A-Za-z0-9._-]+$/
const UNSAFE_OBJECT_KEYS = new Set(["__proto__", "prototype", "constructor"])

function resolveApiBaseUrl(): string {
  const explicitApi = process.env.KILO_API_URL?.trim()
  if (explicitApi) {
    return explicitApi
  }

  const backendBase = process.env.KILOCODE_BACKEND_BASE_URL?.trim()
  if (!backendBase || backendBase === DEFAULT_BACKEND_BASE_URL) {
    return DEFAULT_API_BASE_URL
  }

  return backendBase
}

function resolveMarketplaceBaseUrls(): string[] {
  const explicitApi = process.env.KILO_API_URL?.trim()
  const backendBase = process.env.KILOCODE_BACKEND_BASE_URL?.trim()
  const preferred = resolveApiBaseUrl()
  const candidates = [
    preferred,
    explicitApi,
    backendBase,
    DEFAULT_API_BASE_URL,
    DEFAULT_BACKEND_BASE_URL,
  ]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .map((value) => value.replace(/\/+$/, ""))
  return Array.from(new Set(candidates))
}

type CacheEntry = {
  items: MarketplaceItem[]
  fetchedAt: number
}

export class MarketplaceService {
  private cache: CacheEntry | null = null

  async getCatalog(): Promise<MarketplaceCatalogResult> {
    const errors: string[] = []
    let items: MarketplaceItem[] = []

    try {
      const baseItems = await this.getCachedOrFetchItems()
      items = baseItems
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error))
    }

    const installedMetadata = await this.getInstalledMetadata(items).catch((error) => {
      errors.push(error instanceof Error ? error.message : String(error))
      return { project: {}, global: {} } satisfies MarketplaceInstalledMetadata
    })

    return {
      items,
      installedMetadata,
      ...(errors.length > 0 ? { errors } : {}),
    }
  }

  invalidateCache(): void {
    this.cache = null
  }

  async installItem(item: MarketplaceItem, options: MarketplaceInstallOptions): Promise<void> {
    if (item.managedByOrganization) {
      throw new Error("This item is managed by your organization")
    }

    switch (item.type) {
      case "mode":
        await this.installMode(item, options.target)
        return
      case "mcp":
        await this.installMcp(item, options)
        return
      case "skill":
        await this.installSkill(item, options.target)
        return
      default:
        throw new Error(`Unsupported marketplace item type: ${String((item as { type?: unknown }).type)}`)
    }
  }

  async removeItem(item: MarketplaceItem, target: "project" | "global"): Promise<void> {
    if (item.managedByOrganization) {
      throw new Error("This item is managed by your organization")
    }

    switch (item.type) {
      case "mode":
        await this.removeMode(item, target)
        return
      case "mcp":
        await this.removeMcp(item, target)
        return
      case "skill":
        await this.removeSkill(item, target)
        return
      default:
        throw new Error(`Unsupported marketplace item type: ${String((item as { type?: unknown }).type)}`)
    }
  }

  private async getCachedOrFetchItems(): Promise<MarketplaceItem[]> {
    const now = Date.now()
    if (this.cache && now - this.cache.fetchedAt < CACHE_TTL_MS) {
      return this.cache.items
    }

    const [modes, mcps, skills] = await Promise.all([this.fetchModes(), this.fetchMcps(), this.fetchSkills()])
    const items = [...modes, ...mcps, ...skills]
    this.cache = { items, fetchedAt: now }
    return items
  }

  private async fetchModes(): Promise<MarketplaceItem[]> {
    const text = await this.fetchCatalogText("/api/marketplace/modes")
    const parsed = this.parseStructured(text)
    const validated = modeMarketplaceCatalogSchema.parse(parsed)
    return validated.items.map((item) =>
      marketplaceItemSchema.parse({
        ...item,
        type: "mode",
      }),
    )
  }

  private async fetchMcps(): Promise<MarketplaceItem[]> {
    const text = await this.fetchCatalogText("/api/marketplace/mcps")
    const parsed = this.parseStructured(text)
    const validated = mcpMarketplaceCatalogSchema.parse(parsed)
    return validated.items.map((item) =>
      marketplaceItemSchema.parse({
        ...item,
        type: "mcp",
      }),
    )
  }

  private async fetchSkills(): Promise<MarketplaceItem[]> {
    const text = await this.fetchCatalogText("/api/marketplace/skills")
    const parsed = this.parseStructured(text)
    const validated = skillsMarketplaceCatalogSchema.parse(parsed)
    return validated.items.map((skill) =>
      marketplaceItemSchema.parse({
        type: "skill",
        id: skill.id,
        name: skill.id,
        description: skill.description,
        category: skill.category,
        githubUrl: skill.githubUrl,
        content: skill.content,
        displayName: this.kebabToTitle(skill.id),
        displayCategory: this.kebabToTitle(skill.category),
      }),
    )
  }

  private async fetchCatalogText(route: string): Promise<string> {
    const baseUrls = resolveMarketplaceBaseUrls()
    const errors: string[] = []

    for (const baseUrl of baseUrls) {
      const url = `${baseUrl}${route}`
      for (let attempt = 1; attempt <= MARKETPLACE_FETCH_RETRIES; attempt++) {
        try {
          const response = await this.fetchWithTimeout(url, MARKETPLACE_FETCH_TIMEOUT_MS)
          const text = await response.text()
          if (!response.ok) {
            const snippet = text.trim().slice(0, 140)
            const failure = `(${response.status}) ${url}${snippet ? `: ${snippet}` : ""}`
            if (response.status >= 500 || response.status === 429) {
              errors.push(`Marketplace request failed ${failure}`)
              await this.delayBeforeRetry(attempt)
              continue
            }
            errors.push(`Marketplace request failed ${failure}`)
            break
          }
          if (this.looksLikeHtml(text)) {
            errors.push(`Marketplace endpoint ${url} returned HTML instead of JSON/YAML`)
            break
          }
          return text
        } catch (error) {
          errors.push(`Marketplace request failed (${url}): ${error instanceof Error ? error.message : String(error)}`)
          await this.delayBeforeRetry(attempt)
        }
      }
    }

    const detail = errors.length > 0 ? ` ${errors.slice(0, 6).join(" | ")}` : ""
    throw new Error(`Marketplace request failed for ${route}.${detail}`)
  }

  private parseStructured(text: string): unknown {
    const trimmed = text.trim()
    if (!trimmed) {
      return {}
    }
    if (this.looksLikeHtml(trimmed)) {
      throw new Error("Received HTML content where structured marketplace data was expected")
    }

    try {
      const parsed = JSON.parse(trimmed)
      if (typeof parsed === "string") {
        const reparsed = parsed.trim()
        if (!reparsed) {
          return {}
        }
        if (this.looksLikeHtml(reparsed)) {
          throw new Error("Received HTML content where structured marketplace data was expected")
        }
        try {
          return JSON.parse(reparsed)
        } catch {
          return YAML.parse(reparsed)
        }
      }
      return parsed
    } catch {
      const parsedYaml = YAML.parse(trimmed)
      if (typeof parsedYaml === "string" && this.looksLikeHtml(parsedYaml)) {
        throw new Error("Received HTML content where structured marketplace data was expected")
      }
      return parsedYaml
    }
  }

  private looksLikeHtml(text: string): boolean {
    return /^\s*<!doctype\s+html/i.test(text) || /^\s*<html[\s>]/i.test(text)
  }

  private async fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)
    try {
      return await fetch(url, {
        headers: {
          Accept: "application/json, text/yaml, text/plain",
          "User-Agent": "kilo-code-vscode-marketplace",
        },
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timeout)
    }
  }

  private async delayBeforeRetry(attempt: number): Promise<void> {
    if (attempt >= MARKETPLACE_FETCH_RETRIES) {
      return
    }
    const delayMs = Math.pow(2, attempt - 1) * MARKETPLACE_RETRY_BASE_DELAY_MS
    await new Promise((resolve) => setTimeout(resolve, delayMs))
  }

  private kebabToTitle(value: string): string {
    return value
      .split("-")
      .map((part) => (part.length === 0 ? part : part[0].toUpperCase() + part.slice(1)))
      .join(" ")
  }

  private getWorkspaceDir(): string {
    const folder = vscode.workspace.workspaceFolders?.[0]
    if (!folder) {
      throw new Error("No workspace folder found")
    }
    return folder.uri.fsPath
  }

  private getLegacyGlobalStoragePath(): string {
    const home = os.homedir()
    switch (process.platform) {
      case "darwin":
        return path.join(home, "Library", "Application Support", "Code", "User", "globalStorage", "kilocode.kilo-code")
      case "win32":
        return path.join(
          process.env.APPDATA || path.join(home, "AppData", "Roaming"),
          "Code",
          "User",
          "globalStorage",
          "kilocode.kilo-code",
        )
      default:
        return path.join(home, ".config", "Code", "User", "globalStorage", "kilocode.kilo-code")
    }
  }

  private modeFilePath(target: "project" | "global"): string {
    if (target === "project") {
      return path.join(this.getWorkspaceDir(), ".kilocodemodes")
    }
    return path.join(this.getLegacyGlobalStoragePath(), "settings", "custom_modes.yaml")
  }

  private getProjectKiloDirectoryPath(): string {
    const workspaceDir = this.getWorkspaceDir()
    const kiloDir = path.join(workspaceDir, ".kilocode")
    const legacyDir = path.join(workspaceDir, ".roo")
    if (existsSync(legacyDir) && !existsSync(kiloDir)) {
      return legacyDir
    }
    return kiloDir
  }

  private getGlobalKiloDirectoryPath(): string {
    const home = os.homedir()
    const kiloDir = path.join(home, ".kilocode")
    const legacyDir = path.join(home, ".roo")
    if (existsSync(legacyDir) && !existsSync(kiloDir)) {
      return legacyDir
    }
    return kiloDir
  }

  private mcpFilePath(target: "project" | "global"): string {
    if (target === "project") {
      return path.join(this.getProjectKiloDirectoryPath(), "mcp.json")
    }
    return path.join(this.getLegacyGlobalStoragePath(), "settings", "mcp_settings.json")
  }

  private skillsDirPath(target: "project" | "global"): string {
    if (target === "project") {
      return path.join(this.getProjectKiloDirectoryPath(), "skills")
    }
    return path.join(this.getGlobalKiloDirectoryPath(), "skills")
  }

  private async readYamlObject(filePath: string): Promise<Record<string, unknown> | null> {
    try {
      const raw = await fs.readFile(filePath, "utf-8")
      const parsed = YAML.parse(raw)
      if (parsed && typeof parsed === "object") {
        return parsed as Record<string, unknown>
      }
      return null
    } catch {
      return null
    }
  }

  private async readYamlObjectStrict(filePath: string): Promise<Record<string, unknown>> {
    const raw = await fs.readFile(filePath, "utf-8")
    const parsed = YAML.parse(raw)
    if (!parsed || typeof parsed !== "object") {
      throw new Error(`Invalid YAML structure in ${path.basename(filePath)}`)
    }
    return parsed as Record<string, unknown>
  }

  private async readJsonObject(filePath: string): Promise<Record<string, unknown> | null> {
    try {
      const raw = await fs.readFile(filePath, "utf-8")
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed === "object") {
        return parsed as Record<string, unknown>
      }
      return null
    } catch {
      return null
    }
  }

  private async readJsonObjectStrict(filePath: string): Promise<Record<string, unknown>> {
    const raw = await fs.readFile(filePath, "utf-8")
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== "object") {
      throw new Error(`Invalid JSON structure in ${path.basename(filePath)}`)
    }
    return parsed as Record<string, unknown>
  }

  private async getInstalledMetadata(catalogItems: MarketplaceItem[]): Promise<MarketplaceInstalledMetadata> {
    const metadata: MarketplaceInstalledMetadata = { project: {}, global: {} }

    await this.collectModeMetadata("project", metadata.project)
    await this.collectModeMetadata("global", metadata.global)
    await this.collectMcpMetadata("project", metadata.project)
    await this.collectMcpMetadata("global", metadata.global)
    await this.collectSkillsMetadata("project", metadata.project)
    await this.collectSkillsMetadata("global", metadata.global)
    this.markOrganizationManagedItemsInstalled(catalogItems, metadata)

    return metadata
  }

  private markOrganizationManagedItemsInstalled(
    catalogItems: MarketplaceItem[],
    metadata: MarketplaceInstalledMetadata,
  ): void {
    for (const item of catalogItems) {
      if (!item.managedByOrganization) {
        continue
      }
      metadata.global[item.id] = { type: item.type }
    }
  }

  private async collectModeMetadata(
    target: "project" | "global",
    output: Record<string, { type: MarketplaceItemType }>,
  ): Promise<void> {
    const filePath = this.modeFilePath(target)
    const parsed = await this.readYamlObject(filePath)
    const modes = parsed?.customModes
    if (!Array.isArray(modes)) {
      return
    }
    for (const mode of modes) {
      if (!mode || typeof mode !== "object") {
        continue
      }
      const slug = (mode as Record<string, unknown>).slug
      if (typeof slug === "string" && slug.length > 0) {
        output[slug] = { type: "mode" }
      }
    }
  }

  private async collectMcpMetadata(
    target: "project" | "global",
    output: Record<string, { type: MarketplaceItemType }>,
  ): Promise<void> {
    const filePath = this.mcpFilePath(target)
    const parsed = await this.readJsonObject(filePath)
    const servers = parsed?.mcpServers
    if (!servers || typeof servers !== "object") {
      return
    }
    for (const key of Object.keys(servers)) {
      output[key] = { type: "mcp" }
    }
  }

  private async collectSkillsMetadata(
    target: "project" | "global",
    output: Record<string, { type: MarketplaceItemType }>,
  ): Promise<void> {
    const dir = this.skillsDirPath(target)
    let entries: string[] = []
    try {
      entries = await fs.readdir(dir)
    } catch {
      return
    }

    for (const entry of entries) {
      const skillMd = path.join(dir, entry, "SKILL.md")
      try {
        await fs.access(skillMd)
        output[entry] = { type: "skill" }
      } catch {
        // Ignore non-skill entries.
      }
    }
  }

  private async installMode(item: Extract<MarketplaceItem, { type: "mode" }>, target: "project" | "global"): Promise<void> {
    const filePath = this.modeFilePath(target)
    const modeData = YAML.parse(item.content)
    if (!modeData || typeof modeData !== "object") {
      throw new Error("Invalid mode content")
    }

    const modeRecord = modeData as Record<string, unknown>
    const slug = typeof modeRecord.slug === "string" && modeRecord.slug.length > 0 ? modeRecord.slug : item.id
    modeRecord.slug = slug

    let parsed: Record<string, unknown> = {}
    try {
      parsed = await this.readYamlObjectStrict(filePath)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== "ENOENT") {
        throw new Error(
          `Cannot install mode: ${path.basename(filePath)} contains invalid YAML. Fix the file before installing.`,
        )
      }
    }
    const existingModes = Array.isArray(parsed.customModes) ? parsed.customModes : []
    const nextModes = existingModes.filter((mode) => {
      if (!mode || typeof mode !== "object") {
        return true
      }
      return (mode as Record<string, unknown>).slug !== slug
    })
    nextModes.push(modeRecord)

    const output = { ...parsed, customModes: nextModes }
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    await fs.writeFile(filePath, YAML.stringify(output), "utf-8")
  }

  private async removeMode(item: Extract<MarketplaceItem, { type: "mode" }>, target: "project" | "global"): Promise<void> {
    const filePath = this.modeFilePath(target)
    const parsed = await this.readYamlObject(filePath)
    if (!parsed) {
      return
    }
    let slug = item.id
    try {
      const modeData = YAML.parse(item.content)
      if (modeData && typeof modeData === "object") {
        const parsedSlug = (modeData as Record<string, unknown>).slug
        if (typeof parsedSlug === "string" && parsedSlug.length > 0) {
          slug = parsedSlug
        }
      }
    } catch {
      // Fallback to item.id if content is invalid.
    }
    const existingModes = Array.isArray(parsed.customModes) ? parsed.customModes : []
    const nextModes = existingModes.filter((mode) => {
      if (!mode || typeof mode !== "object") {
        return true
      }
      return (mode as Record<string, unknown>).slug !== slug
    })
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    await fs.writeFile(filePath, YAML.stringify({ ...parsed, customModes: nextModes }), "utf-8")
  }

  private async installMcp(item: Extract<MarketplaceItem, { type: "mcp" }>, options: MarketplaceInstallOptions): Promise<void> {
    const filePath = this.mcpFilePath(options.target)
    const mcpId = this.sanitizeMarketplaceItemId(item.id, "MCP server")
    const selectedFromParameters = options.parameters?._selectedIndex
    const selectedIndex =
      typeof options.selectedIndex === "number"
        ? options.selectedIndex
        : typeof selectedFromParameters === "number"
          ? selectedFromParameters
          : undefined
    let contentToUse = this.resolveMcpInstallContent(item.content, selectedIndex)

    const parameters = { ...(options.parameters ?? {}) }
    const methodParameters = Array.isArray(item.content)
      ? (item.content[selectedIndex ?? 0]?.parameters ?? item.content[0]?.parameters ?? [])
      : []
    const allParameters = [...(item.parameters ?? []), ...(methodParameters ?? [])]
    for (const param of allParameters) {
      const value = parameters[param.key]
      if (value !== undefined) {
        contentToUse = this.replaceTemplateToken(contentToUse, param.key, String(value))
      }
    }

    if (!contentToUse.trim()) {
      throw new Error(`MCP item "${item.id}" has empty server configuration content`)
    }

    const parsedServer = this.sanitizeMcpServerConfig(this.parseStructured(contentToUse), mcpId)

    let existing: Record<string, unknown> = {}
    try {
      existing = await this.readJsonObjectStrict(filePath)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== "ENOENT") {
        throw new Error(
          `Cannot install MCP server: ${path.basename(filePath)} contains invalid JSON. Fix the file before installing.`,
        )
      }
    }
    const existingServers =
      existing.mcpServers && typeof existing.mcpServers === "object" ? (existing.mcpServers as Record<string, unknown>) : {}
    const nextServers = { ...existingServers, [mcpId]: parsedServer }

    await fs.mkdir(path.dirname(filePath), { recursive: true })
    await fs.writeFile(filePath, JSON.stringify({ ...existing, mcpServers: nextServers }, null, 2), "utf-8")
  }

  private async removeMcp(item: Extract<MarketplaceItem, { type: "mcp" }>, target: "project" | "global"): Promise<void> {
    const mcpId = this.sanitizeMarketplaceItemId(item.id, "MCP server")
    const filePath = this.mcpFilePath(target)
    const existing = await this.readJsonObject(filePath)
    if (!existing) {
      return
    }
    const existingServers =
      existing.mcpServers && typeof existing.mcpServers === "object" ? (existing.mcpServers as Record<string, unknown>) : {}
    if (!(mcpId in existingServers)) {
      return
    }
    const nextServers = { ...existingServers }
    delete nextServers[mcpId]

    await fs.mkdir(path.dirname(filePath), { recursive: true })
    await fs.writeFile(filePath, JSON.stringify({ ...existing, mcpServers: nextServers }, null, 2), "utf-8")
  }

  private resolveMcpInstallContent(content: string | MarketplaceMcpInstallMethod[], selectedIndex?: number): string {
    if (typeof content === "string") {
      return content
    }
    const index = selectedIndex ?? 0
    const method = content[index] ?? content[0]
    if (!method || typeof method.content !== "string") {
      throw new Error("No valid MCP installation method found")
    }
    return method.content
  }

  private async installSkill(item: MarketplaceSkillItem, target: "project" | "global"): Promise<void> {
    const skillId = this.sanitizeMarketplaceItemId(item.id, "skill")
    const tarballUrl = item.content
    if (typeof tarballUrl !== "string" || tarballUrl.trim().length === 0) {
      throw new Error("Skill item missing tarball URL")
    }

    const response = await fetch(tarballUrl)
    if (!response.ok) {
      throw new Error(`Failed to download skill tarball (${response.status})`)
    }

    const destination = path.join(this.skillsDirPath(target), skillId)
    const tmpFile = path.join(os.tmpdir(), `kilo-skill-${skillId}-${Date.now()}.tar.gz`)

    await fs.mkdir(path.dirname(destination), { recursive: true })
    await fs.mkdir(destination, { recursive: true })

    try {
      const bytes = Buffer.from(await response.arrayBuffer())
      await fs.writeFile(tmpFile, bytes)
      await pipeline(
        createReadStream(tmpFile),
        zlib.createGunzip(),
        tarFs.extract(destination, {
          strip: 1,
          map: (header) => {
            this.assertSafeTarPath(header.name, skillId, "name")
            if (typeof header.linkname === "string") {
              this.assertSafeTarPath(header.linkname, skillId, "linkname")
            }
            return header
          },
        }),
      )
      await fs.access(path.join(destination, "SKILL.md"))
    } catch (error) {
      await fs.rm(destination, { recursive: true, force: true }).catch(() => {})
      throw error
    } finally {
      await fs.rm(tmpFile, { force: true }).catch(() => {})
    }
  }

  private async removeSkill(item: MarketplaceSkillItem, target: "project" | "global"): Promise<void> {
    const skillId = this.sanitizeMarketplaceItemId(item.id, "skill")
    const destination = path.join(this.skillsDirPath(target), skillId)
    await fs.rm(destination, { recursive: true, force: true }).catch((error) => {
      console.debug("[Kilo New] Marketplace: removeSkill ignored rm error", { item: item.id, error })
    })
  }

  private replaceTemplateToken(content: string, key: string, value: string): string {
    return content.split(`{{${key}}}`).join(value)
  }

  private sanitizeMarketplaceItemId(rawId: string, kind: string): string {
    const id = rawId.trim()
    if (!SAFE_MARKETPLACE_ID_PATTERN.test(id) || UNSAFE_OBJECT_KEYS.has(id)) {
      throw new Error(`Marketplace ${kind} id "${rawId}" is invalid`)
    }
    return id
  }

  private sanitizeMcpServerConfig(input: unknown, itemId: string): Record<string, unknown> {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      throw new Error(`MCP item "${itemId}" has invalid server configuration content`)
    }
    this.assertSafeObjectKeys(input, `MCP item "${itemId}"`)

    const config = { ...(input as Record<string, unknown>) }

    if (config.command !== undefined) {
      if (typeof config.command === "string") {
        const command = config.command.trim()
        if (!command) {
          throw new Error(`MCP item "${itemId}" has an empty command`)
        }
        config.command = command
      } else if (Array.isArray(config.command)) {
        const command = config.command.map((entry) => String(entry).trim()).filter((entry) => entry.length > 0)
        if (command.length === 0) {
          throw new Error(`MCP item "${itemId}" has an empty command array`)
        }
        config.command = command
      } else {
        throw new Error(`MCP item "${itemId}" has invalid command`)
      }
    }

    if (config.args !== undefined) {
      if (!Array.isArray(config.args) || config.args.some((arg) => typeof arg !== "string")) {
        throw new Error(`MCP item "${itemId}" has invalid args`)
      }
      config.args = config.args.map((arg) => arg.trim())
    }

    if (config.env !== undefined) {
      if (!this.isStringRecord(config.env)) {
        throw new Error(`MCP item "${itemId}" has invalid env`)
      }
      config.env = { ...config.env }
    }

    if (config.environment !== undefined) {
      if (!this.isStringRecord(config.environment)) {
        throw new Error(`MCP item "${itemId}" has invalid environment`)
      }
      config.environment = { ...config.environment }
    }

    if (config.timeout !== undefined) {
      if (typeof config.timeout !== "number" || !Number.isFinite(config.timeout) || config.timeout <= 0 || config.timeout > 600_000) {
        throw new Error(`MCP item "${itemId}" has invalid timeout`)
      }
    }

    if (config.enabled !== undefined && typeof config.enabled !== "boolean") {
      throw new Error(`MCP item "${itemId}" has invalid enabled flag`)
    }

    return config
  }

  private isStringRecord(value: unknown): value is Record<string, string> {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return false
    }
    return Object.values(value).every((entry) => typeof entry === "string")
  }

  private assertSafeObjectKeys(value: unknown, context: string): void {
    if (!value || typeof value !== "object") {
      return
    }
    if (Array.isArray(value)) {
      for (const entry of value) {
        this.assertSafeObjectKeys(entry, context)
      }
      return
    }
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if (UNSAFE_OBJECT_KEYS.has(key)) {
        throw new Error(`${context} contains unsafe key "${key}"`)
      }
      this.assertSafeObjectKeys(nested, context)
    }
  }

  private assertSafeTarPath(rawPath: string, itemId: string, field: "name" | "linkname"): void {
    const normalized = rawPath.replace(/\\/g, "/")
    const segments = normalized.split("/")
    if (
      normalized.length === 0 ||
      normalized.startsWith("/") ||
      normalized.includes("\u0000") ||
      /^[A-Za-z]:\//.test(normalized) ||
      segments.some((segment) => segment === "..")
    ) {
      throw new Error(`Unsafe tar ${field} in skill "${itemId}"`)
    }
  }
}
