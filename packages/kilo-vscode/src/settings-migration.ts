import * as vscode from "vscode"
import type { Config } from "./services/cli-backend"

const MIGRATION_STATE_KEY = "kilo.legacySettingsMigration.v1"
const NEW_PREFIX = "kilo-code.new."
const OLD_PREFIX = "kilo-code."

type SettingScope = "global" | "workspace"

type MigrationStep = {
  oldKey: string
  newKey: string
  scope: SettingScope
  value: unknown
}

function splitSettingKey(key: string) {
  const idx = key.lastIndexOf(".")
  if (idx <= 0 || idx === key.length - 1) return { section: key, leaf: "" }
  return { section: key.slice(0, idx), leaf: key.slice(idx + 1) }
}

function nonEmptyObject(value: unknown): boolean {
  return !!value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length > 0
}

function hasCliOverrides(config?: Config): boolean {
  if (!config) return false
  return Object.values(config).some((value) => {
    if (value === undefined) return false
    if (Array.isArray(value)) return value.length > 0
    if (typeof value === "object" && value !== null) return nonEmptyObject(value)
    return true
  })
}

function getNewSettingKeys(extension: vscode.Extension<unknown> | undefined): string[] {
  const properties = extension?.packageJSON?.contributes?.configuration?.properties as Record<string, unknown> | undefined
  if (!properties) return []
  return Object.keys(properties).filter((key) => key.startsWith(NEW_PREFIX))
}

function formatValue(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value)
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  if (value === null || value === undefined) return String(value)
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function collectSteps(extension: vscode.Extension<unknown> | undefined): MigrationStep[] {
  const steps: MigrationStep[] = []
  const newKeys = getNewSettingKeys(extension)

  for (const newKey of newKeys) {
    const oldKey = OLD_PREFIX + newKey.slice(NEW_PREFIX.length)
    const newInfo = splitSettingKey(newKey)
    const oldInfo = splitSettingKey(oldKey)
    if (!newInfo.leaf || !oldInfo.leaf) continue

    const oldCfg = vscode.workspace.getConfiguration(oldInfo.section)
    const newCfg = vscode.workspace.getConfiguration(newInfo.section)
    const oldInspect = oldCfg.inspect(oldInfo.leaf)
    const newInspect = newCfg.inspect(newInfo.leaf)

    if (!oldInspect || !newInspect) continue

    if (oldInspect.globalValue !== undefined && newInspect.globalValue === undefined) {
      steps.push({
        oldKey,
        newKey,
        scope: "global",
        value: oldInspect.globalValue,
      })
    }

    if (oldInspect.workspaceValue !== undefined && newInspect.workspaceValue === undefined) {
      steps.push({
        oldKey,
        newKey,
        scope: "workspace",
        value: oldInspect.workspaceValue,
      })
    }
  }

  return steps
}

async function applySteps(steps: MigrationStep[]) {
  for (const step of steps) {
    const info = splitSettingKey(step.newKey)
    if (!info.leaf) continue
    const target =
      step.scope === "workspace" ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global
    await vscode.workspace.getConfiguration(info.section).update(info.leaf, step.value, target)
  }
}

function renderDiff(title: string, steps: MigrationStep[]): string {
  const header = [`# ${title}`, "", `Detected ${steps.length} setting migration(s).`, ""]
  const body = steps.flatMap((step) => {
    const value = formatValue(step.value).split("\n")
    const lines = [`--- ${step.oldKey} [${step.scope}]`, `+++ ${step.newKey} [${step.scope}]`]
    if (value.length === 1) {
      lines.push(`+ ${value[0] ?? ""}`)
    } else {
      lines.push("+ " + (value[0] ?? ""))
      for (const line of value.slice(1)) {
        lines.push("+ " + line)
      }
    }
    return [...lines, ""]
  })
  return [...header, ...body].join("\n")
}

async function showDiffDocument(title: string, steps: MigrationStep[]) {
  const doc = await vscode.workspace.openTextDocument({
    language: "diff",
    content: renderDiff(title, steps),
  })
  await vscode.window.showTextDocument(doc, { preview: false })
}

export async function migrateLegacySettingsIfNeeded(input: {
  context: vscode.ExtensionContext | undefined
  cliConfig?: Config
}) {
  const context = input.context
  if (!context) return
  if (context.globalState.get<boolean>(MIGRATION_STATE_KEY)) return

  try {
    const extension = vscode.extensions.getExtension("kilocode.kilo-code")
    const steps = collectSteps(extension)
    if (steps.length === 0) {
      return
    }

    if (hasCliOverrides(input.cliConfig)) {
      const action = "View diff"
      const selected = await vscode.window.showInformationMessage(
        `Kilo detected ${steps.length} legacy settings from the old extension. CLI config is already set, so changes were not auto-applied.`,
        action,
      )
      if (selected === action) {
        await showDiffDocument("Kilo Settings Migration Preview (Not Applied)", steps)
      }
      return
    }

    await applySteps(steps)
    const action = "View migrated settings"
    const selected = await vscode.window.showInformationMessage(
      `Migrated ${steps.length} legacy Kilo setting${steps.length === 1 ? "" : "s"} to the new namespace.`,
      action,
    )
    if (selected === action) {
      await showDiffDocument("Kilo Settings Migration (Applied)", steps)
    }
  } catch (error) {
    console.error("[Kilo New] Settings migration failed:", error)
  } finally {
    await context.globalState.update(MIGRATION_STATE_KEY, true)
  }
}
