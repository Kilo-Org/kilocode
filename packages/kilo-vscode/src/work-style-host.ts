// Host side of the first-run work style picker. The webview cannot write the Kilo config, so the host reads the
// config documents, applies only the values that are still unset, and stores the choice as a VS Code setting.
import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { ConfigurationTarget, workspace, type ExtensionContext } from "vscode"
import { parse } from "jsonc-parser/lib/esm/main.js"
import { applyConfigEdits, configWriteQueue, isKiloConfigFile } from "./config-file-edit"
import { configTargets, type ConfigEntry } from "./config-targets"
import { local } from "./local"
import { resolveKiloProfile } from "./settings-paths"
import {
  buildWorkStylePlan,
  getInitialWorkStyle,
  type WorkStyle,
  type WorkStyleSettings,
  type WorkStyleState,
} from "./shared/work-style-presets"
import type { ConfigEdit, ToWebview } from "./protocol"
import type { Manager } from "./server"

const NAMESPACE = "kilo-code.v2"
const WORK_STYLE_KEY = "agentWorkStyle"
const SETTING_KEYS: (keyof WorkStyleSettings)[] = ["showTaskTimeline", "showAutoApprovalReason"]

type Deps = {
  context: ExtensionContext
  server: Manager
  directory: string
  post: (message: ToWebview) => void
}

function configuration() {
  return workspace.getConfiguration(NAMESPACE)
}

function state(): WorkStyleState {
  const value = configuration().get<string>(WORK_STYLE_KEY, "unset")
  return isState(value) ? value : "unset"
}

function isState(value: unknown): value is WorkStyleState {
  return value === "unset" || value === "skipped" || value === "human-in-the-loop" || value === "autonomous"
}

function isStyle(value: unknown): value is WorkStyle {
  return value === "human-in-the-loop" || value === "autonomous"
}

async function setState(style: WorkStyleState) {
  await configuration().update(WORK_STYLE_KEY, style, ConfigurationTarget.Global)
}

async function entries(deps: Deps) {
  const server = await deps.server.get()
  const query = new URLSearchParams({ "location[directory]": deps.directory })
  const response = await local(new URL(`/api/config?${query}`, server.url), {
    headers: { authorization: server.authorization },
  })
  return (await response.json()) as ConfigEntry[]
}

async function hasAnySession(deps: Deps) {
  const server = await deps.server.get()
  const query = new URLSearchParams({
    limit: "1",
    parentID: "null",
    directory: deps.directory,
  })
  const response = await local(new URL(`/api/session?${query}`, server.url), {
    headers: { authorization: server.authorization },
  })
  const data = (await response.json()) as { data?: unknown[] }
  return Array.isArray(data.data) && data.data.length > 0
}

function values(texts: string[]): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const text of texts) {
    const parsed: unknown = parse(text, [], { allowTrailingComma: true })
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) continue
    Object.assign(result, parsed)
  }
  return result
}

async function current(deps: Deps) {
  const list = await entries(deps)
  const targets = await configTargets({
    entries: list,
    directory: deps.directory,
    profile: resolveKiloProfile(deps.context),
  })
  const texts: string[] = []
  for (const entry of list) {
    if (entry.type !== "document" || !entry.path) continue
    texts.push(await readFile(entry.path, "utf8").catch(() => ""))
  }
  return { target: targets.global, values: values(texts) }
}

async function initialize(deps: Deps) {
  if (state() !== "unset") return
  // A failed probe propagates: the request answers skipped without persisting, so a later request retries.
  const sessions = await hasAnySession(deps)
  if (state() !== "unset") return
  // A project that already has sessions is an existing user; do not show the picker again.
  if (getInitialWorkStyle(sessions) === "skipped") await setState("skipped")
}

function customized(key: keyof WorkStyleSettings): boolean {
  const info = configuration().inspect(key)
  return (
    info?.globalValue !== undefined || info?.workspaceValue !== undefined || info?.workspaceFolderValue !== undefined
  )
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function apply(deps: Deps, style: WorkStyle) {
  const config = await current(deps)
  const settings = configuration()
  const plan = buildWorkStylePlan({ style, config: config.values, settingCustomized: customized })
  const edits: ConfigEdit[] = Object.entries(plan.config).map(([key, value]) => ({ path: [key], value }))
  const previousState = settings.inspect(WORK_STYLE_KEY)?.globalValue
  const previousSettings = Object.fromEntries(SETTING_KEYS.map((key) => [key, settings.inspect(key)?.globalValue]))
  let writeAttempted = false
  let previous: { text: string; existed: boolean } | undefined

  try {
    if (edits.length > 0) {
      await configWriteQueue(async () => {
        if (!isKiloConfigFile(config.target)) {
          throw new Error(`Refused a config write outside a Kilo config file: ${config.target}`)
        }
        // Read inside the queue so a concurrent settings or speech write is not overwritten by a stale snapshot.
        previous = await readFile(config.target, "utf8").then(
          (text) => ({ text, existed: true }),
          (error: NodeJS.ErrnoException) => {
            if (error.code === "ENOENT") return { text: "", existed: false }
            throw error
          },
        )
        writeAttempted = true
        await mkdir(path.dirname(config.target), { recursive: true })
        await writeFile(config.target, applyConfigEdits(previous.text, edits))
      })
    }
    for (const [key, value] of Object.entries(plan.settings)) {
      await settings.update(key, value, ConfigurationTarget.Global)
    }
    await settings.update(WORK_STYLE_KEY, style, ConfigurationTarget.Global)
    return { ok: true as const }
  } catch (error) {
    const rollback: string[] = []
    for (const [key, value] of Object.entries(previousSettings)) {
      await Promise.resolve(settings.update(key, value, ConfigurationTarget.Global)).catch(() => rollback.push(key))
    }
    await Promise.resolve(settings.update(WORK_STYLE_KEY, previousState, ConfigurationTarget.Global)).catch(() =>
      rollback.push(WORK_STYLE_KEY),
    )
    if (writeAttempted && previous) {
      const restore = previous
      await configWriteQueue(async () => {
        if (restore.existed) await writeFile(config.target, restore.text)
        else await rm(config.target, { force: true })
      }).catch(() => rollback.push("config"))
    }
    return { ok: false as const, error: message(error), rollbackFailed: rollback.length > 0 }
  }
}

export function workStyleHost(deps: Deps) {
  return {
    async handle(input: { type?: string; style?: unknown }): Promise<boolean> {
      if (input.type === "requestWorkStyle") {
        const initialized = await initialize(deps).then(
          () => true,
          (error: unknown) => {
            console.error("[Kilo] Failed to initialize work style:", error)
            return false
          },
        )
        deps.post({ type: "workStyleLoaded", style: initialized ? state() : "skipped" })
        return true
      }
      if (input.type === "applyWorkStyle") {
        if (!isStyle(input.style)) {
          deps.post({ type: "workStyleApplyFailed", message: "Invalid work style", rollbackFailed: false })
          return true
        }
        const result = await apply(deps, input.style).catch((error: unknown) => ({
          ok: false as const,
          error: message(error),
          rollbackFailed: false,
        }))
        deps.post(
          result.ok
            ? { type: "workStyleApplied", style: input.style }
            : { type: "workStyleApplyFailed", message: result.error, rollbackFailed: result.rollbackFailed },
        )
        return true
      }
      if (input.type === "setWorkStyle") {
        if (!isState(input.style)) return true
        await setState(input.style).catch((error: unknown) => {
          console.error("[Kilo] Failed to save work style:", error)
        })
        deps.post({ type: "workStyleLoaded", style: state() })
        return true
      }
      return false
    },
  }
}
