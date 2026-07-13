import os from "os"
import path from "path"
import { unique } from "remeda"
import z from "zod"
import { Flag } from "@opencode-ai/core/flag/flag"
import { Global } from "@opencode-ai/core/global"
import { Auth } from "@/auth"
import { ConfigManaged } from "@/config/managed"
import { Filesystem } from "@/util/filesystem"
import { KilocodeConfig } from "./config"

export namespace KilocodeConfigSources {
  export const Scope = z.enum(["global", "project", "env", "managed", "cloud"])
  export type Scope = z.infer<typeof Scope>

  export const Kind = z.enum([
    "remote-wellknown",
    "global-file",
    "env-file",
    "project-file",
    "config-dir",
    "config-dir-file",
    "env-content",
    "cloud-org",
    "managed-dir",
    "managed-file",
    "managed-preferences",
    "runtime-env",
  ])
  export type Kind = z.infer<typeof Kind>

  export const Source = z.object({
    order: z.number().int().nonnegative(),
    kind: Kind,
    scope: Scope,
    label: z.string(),
    source: z.string(),
    path: z.string().optional(),
    exists: z.boolean(),
    editable: z.boolean(),
    reason: z.string().optional(),
  })
  export type Source = z.infer<typeof Source>

  export const Result = z.object({
    sources: Source.array(),
  })
  export type Result = z.infer<typeof Result>

  type Input = {
    directory: string
    worktree?: string
    auth?: Record<string, Auth.Info>
    account?: { url: string; active_org_id?: string | null }
  }

  type Pending = Omit<Source, "order">

  const roots = [".kilocode", ".kilo"] as const
  const global = ["config.json", "opencode.json", "opencode.jsonc", "kilo.json", "kilo.jsonc"] as const

  export async function list(input: Input): Promise<Result> {
    const project = Flag.KILO_DISABLE_PROJECT_CONFIG ? [] : await projectSources(input)
    const dirs = Flag.KILO_DISABLE_PROJECT_CONFIG ? [] : await configDirSources(input)
    const sources = [
      ...wellknownSources(input.auth ?? {}),
      ...(await globalSources()),
      ...(await envFileSources()),
      ...project,
      ...dirs,
      ...envContentSources(),
      ...cloudSources(input.account),
      ...(await managedSources()),
      ...runtimeSources(),
    ]

    return {
      sources: sources.map((item, order) => ({ order, ...item })),
    }
  }

  function wellknownSources(auth: Record<string, Auth.Info>): Pending[] {
    return Object.entries(auth)
      .filter(([, value]) => value.type === "wellknown")
      .map(([key]) => {
        const url = key.replace(/\/+$/, "")
        return {
          kind: "remote-wellknown",
          scope: "cloud",
          label: "Remote well-known config",
          source: `${url}/.well-known/opencode`,
          exists: true,
          editable: false,
          reason: "Configured through auth storage; token values are not exposed.",
        }
      })
  }

  async function globalSources(): Promise<Pending[]> {
    return Promise.all(
      global.map(async (name) => {
        const file = path.join(Global.Path.config, name)
        return fileSource({ kind: "global-file", scope: "global", label: `Global ${name}`, file })
      }),
    )
  }

  async function envFileSources(): Promise<Pending[]> {
    if (!Flag.KILO_CONFIG) return []
    return [
      await fileSource({
        kind: "env-file",
        scope: "env",
        label: "KILO_CONFIG",
        file: Flag.KILO_CONFIG,
        reason: "Explicit config file from KILO_CONFIG.",
      }),
    ]
  }

  async function projectSources(input: Input): Promise<Pending[]> {
    // Mirror ConfigPaths.namedFiles(["opencode", "kilo"]): keep directory
    // proximity primary, then apply Kilo-over-legacy precedence within each directory.
    const files = (
      await Filesystem.findUp(
        ["kilo.jsonc", "kilo.json", "opencode.jsonc", "opencode.json"],
        input.directory,
        input.worktree,
      )
    ).toReversed()
    return Promise.all(
      files.map((file) => fileSource({ kind: "project-file", scope: "project", label: "Project config", file })),
    )
  }

  async function configDirSources(input: Input): Promise<Pending[]> {
    const project = await Filesystem.findUp([...roots], input.directory, input.worktree)
    const home = await Filesystem.findUp([...roots], Global.Path.home, Global.Path.home)
    const env = Flag.KILO_CONFIG_DIR ? [Flag.KILO_CONFIG_DIR] : []
    const dirs = unique([Global.Path.config, ...project, ...home, ...env]).filter((dir) =>
      KilocodeConfig.isConfigDir(dir, Flag.KILO_CONFIG_DIR),
    )

    const result: Pending[] = []
    for (const dir of dirs) {
      const scope = dirScope(dir, { project, home })
      result.push({
        kind: "config-dir",
        scope,
        label: "Config directory",
        source: dir,
        path: dir,
        exists: await Bun.file(dir).exists(),
        editable: scope !== "managed" && scope !== "cloud",
      })

      for (const name of KilocodeConfig.CONFIG_LOAD_ORDER) {
        const file = path.join(dir, name)
        result.push(await fileSource({ kind: "config-dir-file", scope, label: `Config directory ${name}`, file }))
      }
    }
    return result
  }

  function dirScope(dir: string, input: { project: string[]; home: string[] }): Scope {
    if (dir === Flag.KILO_CONFIG_DIR) return "env"
    if (input.project.includes(dir)) return "project"
    if (input.home.includes(dir)) return "global"
    return "global"
  }

  function envContentSources(): Pending[] {
    const sources: Pending[] = []
    if (process.env.KILO_CONFIG_CONTENT) {
      sources.push({
        kind: "env-content",
        scope: "env",
        label: "KILO_CONFIG_CONTENT",
        source: "KILO_CONFIG_CONTENT",
        exists: true,
        editable: false,
        reason: "Inline config content from the process environment; value is not exposed.",
      })
    }
    if (Flag.KILO_CONFIG_DIR) {
      sources.push({
        kind: "runtime-env",
        scope: "env",
        label: "KILO_CONFIG_DIR",
        source: "KILO_CONFIG_DIR",
        path: Flag.KILO_CONFIG_DIR,
        exists: true,
        editable: false,
        reason: "Adds an extra config directory to the load chain.",
      })
    }
    if (Flag.KILO_DISABLE_PROJECT_CONFIG) {
      sources.push({
        kind: "runtime-env",
        scope: "env",
        label: "KILO_DISABLE_PROJECT_CONFIG",
        source: "KILO_DISABLE_PROJECT_CONFIG",
        exists: true,
        editable: false,
        reason: "Project-level config files and directories are disabled for this process.",
      })
    }
    return sources
  }

  function cloudSources(account: Input["account"]): Pending[] {
    if (!account?.active_org_id) return []
    return [
      {
        kind: "cloud-org",
        scope: "cloud",
        label: "Kilo Cloud organization config",
        source: `${account.url}/api/config`,
        exists: true,
        editable: false,
        reason: "Active organization config is managed by Kilo Cloud; values are not exposed here.",
      },
    ]
  }

  async function managedSources(): Promise<Pending[]> {
    const dir = ConfigManaged.managedConfigDir()
    const files = await Promise.all(
      KilocodeConfig.CONFIG_LOAD_ORDER.map((name) =>
        fileSource({
          kind: "managed-file",
          scope: "managed",
          label: `Managed ${name}`,
          file: path.join(dir, name),
          editable: false,
          reason: "Managed config has higher precedence and is read-only in the dashboard.",
        }),
      ),
    )
    return [
      {
        kind: "managed-dir",
        scope: "managed",
        label: "Managed config directory",
        source: dir,
        path: dir,
        exists: await Bun.file(dir).exists(),
        editable: false,
      },
      ...files,
      ...(await managedPreferenceSources()),
    ]
  }

  async function managedPreferenceSources(): Promise<Pending[]> {
    if (process.platform !== "darwin") return []
    const user = os.userInfo().username
    const files = [
      path.join("/Library/Managed Preferences", user, "ai.opencode.managed.plist"),
      path.join("/Library/Managed Preferences", "ai.opencode.managed.plist"),
    ]
    return Promise.all(
      files.map(async (file) => ({
        kind: "managed-preferences" as const,
        scope: "managed" as const,
        label: "macOS managed preferences",
        source: `mobileconfig:${file}`,
        path: file,
        exists: await Bun.file(file).exists(),
        editable: false,
        reason: "Managed preferences are deployed by MDM and override local config.",
      })),
    )
  }

  function runtimeSources(): Pending[] {
    return [
      runtimeSource("KILO_PERMISSION", Flag.KILO_PERMISSION, "Runtime permission overlay."),
      runtimeSource("KILO_DISABLE_AUTOCOMPACT", process.env.KILO_DISABLE_AUTOCOMPACT, "Disables automatic compaction."),
      runtimeSource("KILO_DISABLE_PRUNE", process.env.KILO_DISABLE_PRUNE, "Disables tool-output pruning."),
    ].filter((item): item is Pending => item !== undefined)
  }

  function runtimeSource(label: string, value: string | undefined, reason: string): Pending | undefined {
    if (!value) return undefined
    return {
      kind: "runtime-env",
      scope: "env",
      label,
      source: label,
      exists: true,
      editable: false,
      reason,
    }
  }

  async function fileSource(input: {
    kind: Kind
    scope: Scope
    label: string
    file: string
    editable?: boolean
    reason?: string
  }): Promise<Pending> {
    return {
      kind: input.kind,
      scope: input.scope,
      label: input.label,
      source: input.file,
      path: input.file,
      exists: await Bun.file(input.file).exists(),
      editable: input.editable ?? true,
      reason: input.reason,
    }
  }
}
