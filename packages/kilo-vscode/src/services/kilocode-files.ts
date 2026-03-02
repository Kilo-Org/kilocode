import fs from "fs/promises"
import os from "os"
import path from "path"
import type { RuleFileInfo, WorkflowFileInfo } from "./cli-backend/types"

const KNOWN_MODES = ["code", "architect", "ask", "debug", "orchestrator"]

async function isDir(value: string) {
  return fs
    .stat(value)
    .then((x) => x.isDirectory())
    .catch(() => false)
}

async function isFile(value: string) {
  return fs
    .stat(value)
    .then((x) => x.isFile())
    .catch(() => false)
}

async function markdownFiles(dir: string) {
  return fs
    .readdir(dir, { withFileTypes: true })
    .then((x) => x.filter((entry) => entry.isFile() && entry.name.endsWith(".md")).map((entry) => entry.name))
    .catch(() => [])
}

async function pushMarkdownFiles<T>(out: T[], dir: string, item: (file: string) => T) {
  const files = await markdownFiles(dir)
  for (const file of files) {
    out.push(item(path.join(dir, file)))
  }
}

export async function discoverRuleFiles(workspace: string): Promise<RuleFileInfo[]> {
  const result: RuleFileInfo[] = []
  const globalDir = path.join(os.homedir(), ".kilocode", "rules")
  if (await isDir(globalDir)) {
    await pushMarkdownFiles(result, globalDir, (file) => ({
      path: file,
      name: path.basename(file),
      source: "global",
    }))
  }

  const projectDir = path.join(workspace, ".kilocode", "rules")
  if (await isDir(projectDir)) {
    await pushMarkdownFiles(result, projectDir, (file) => ({
      path: file,
      name: path.basename(file),
      source: "project",
    }))
  }

  const legacy = path.join(workspace, ".kilocoderules")
  if (await isFile(legacy)) {
    result.push({
      path: legacy,
      name: path.basename(legacy),
      source: "legacy",
    })
  }

  for (const mode of KNOWN_MODES) {
    const modeDir = path.join(workspace, ".kilocode", `rules-${mode}`)
    if (await isDir(modeDir)) {
      await pushMarkdownFiles(result, modeDir, (file) => ({
        path: file,
        name: path.basename(file),
        source: "project" as const,
        mode,
      }))
    }

    const legacyMode = path.join(workspace, `.kilocoderules-${mode}`)
    if (await isFile(legacyMode)) {
      result.push({
        path: legacyMode,
        name: path.basename(legacyMode),
        source: "legacy",
        mode,
      })
    }
  }

  return result.sort((a, b) => a.path.localeCompare(b.path))
}

export function extractWorkflowDescription(content: string) {
  const lines = content.split("\n")
  const title = lines.findIndex((line) => line.trim().startsWith("#"))
  if (title === -1) return undefined
  for (const line of lines.slice(title + 1)) {
    const value = line.trim()
    if (!value) continue
    return value.slice(0, 200)
  }
  return undefined
}

export async function discoverWorkflowFiles(options: {
  workspace: string
  globalStorage: string
}): Promise<WorkflowFileInfo[]> {
  const result: WorkflowFileInfo[] = []
  const homeDir = path.join(os.homedir(), ".kilocode", "workflows")
  const vscodeDir = path.join(options.globalStorage, "workflows")
  const projectDir = path.join(options.workspace, ".kilocode", "workflows")

  const pushDir = async (dir: string, source: WorkflowFileInfo["source"]) => {
    if (!(await isDir(dir))) return
    const files = await markdownFiles(dir)
    for (const file of files) {
      const full = path.join(dir, file)
      const content = await fs.readFile(full, "utf-8").catch(() => "")
      result.push({
        path: full,
        name: path.basename(file, ".md"),
        source,
        description: extractWorkflowDescription(content),
      })
    }
  }

  await pushDir(vscodeDir, "global")
  await pushDir(homeDir, "global")
  await pushDir(projectDir, "project")

  const deduped = new Map<string, WorkflowFileInfo>()
  for (const item of result.filter((x) => x.source === "global")) {
    deduped.set(item.name, item)
  }
  for (const item of result.filter((x) => x.source === "project")) {
    deduped.set(item.name, item)
  }
  return [...deduped.values()].sort((a, b) => a.name.localeCompare(b.name))
}
