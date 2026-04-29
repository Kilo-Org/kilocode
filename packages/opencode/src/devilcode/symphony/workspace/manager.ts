import fs from "node:fs"
import path from "node:path"
import os from "node:os"
import { runHook } from "./hooks"
import { SymphonyWorkspaceError } from "../errors"
import type { SymphonyConfig } from "../config/schema"
import type { TrackerIssue } from "../tracker/types"
import { Log } from "@/util/log"

const log = Log.create({ service: "symphony.workspace" })

function sanitizeIdentifier(identifier: string): string {
  return identifier.replace(/[^a-zA-Z0-9._-]/g, "_")
}

function resolveRoot(config: SymphonyConfig): string {
  const root = config.workspace.root
  if (!root) return path.join(os.tmpdir(), "symphony-workspaces")
  return path.resolve(root)
}

function assertContainment(workspacePath: string, root: string): void {
  const normalizedWorkspace = path.resolve(workspacePath)
  const normalizedRoot = path.resolve(root)
  if (!normalizedWorkspace.startsWith(normalizedRoot + path.sep) && normalizedWorkspace !== normalizedRoot) {
    throw new SymphonyWorkspaceError({
      message: `Workspace path ${normalizedWorkspace} is outside root ${normalizedRoot}`,
      workspacePath: normalizedWorkspace,
    })
  }
}

export namespace WorkspaceManager {
  export function getPath(identifier: string, config: SymphonyConfig): string {
    const root = resolveRoot(config)
    const key = sanitizeIdentifier(identifier)
    return path.join(root, key)
  }

  export async function prepare(
    issue: TrackerIssue,
    config: SymphonyConfig,
  ): Promise<{ path: string; isNew: boolean }> {
    const root = resolveRoot(config)
    const workspacePath = getPath(issue.identifier, config)
    assertContainment(workspacePath, root)

    await fs.promises.mkdir(root, { recursive: true })

    const isNew = !fs.existsSync(workspacePath)
    if (isNew) {
      await fs.promises.mkdir(workspacePath, { recursive: true })
    }

    if (isNew && config.hooks.after_create) {
      log.info(`Running after_create hook for ${issue.identifier}`)
      const result = await runHook(config.hooks.after_create, workspacePath, config.hooks.timeout_ms)
      if (result.exitCode !== 0) {
        throw new SymphonyWorkspaceError({
          message: `after_create hook failed with exit code ${result.exitCode}: ${result.stderr}`,
          workspacePath,
          hook: "after_create",
        })
      }
    }

    if (config.hooks.before_run) {
      log.info(`Running before_run hook for ${issue.identifier}`)
      const result = await runHook(config.hooks.before_run, workspacePath, config.hooks.timeout_ms)
      if (result.exitCode !== 0) {
        throw new SymphonyWorkspaceError({
          message: `before_run hook failed with exit code ${result.exitCode}: ${result.stderr}`,
          workspacePath,
          hook: "before_run",
        })
      }
    }

    return { path: workspacePath, isNew }
  }

  export async function cleanup(identifier: string, config: SymphonyConfig): Promise<void> {
    const workspacePath = getPath(identifier, config)

    if (!fs.existsSync(workspacePath)) return

    if (config.hooks.before_remove) {
      try {
        log.info(`Running before_remove hook for ${identifier}`)
        await runHook(config.hooks.before_remove, workspacePath, config.hooks.timeout_ms)
      } catch (e) {
        log.error(`before_remove hook failed for ${identifier}, continuing cleanup`, { error: e })
      }
    }

    if (config.workspace.cleanup) {
      await fs.promises.rm(workspacePath, { recursive: true, force: true })
      log.info(`Cleaned up workspace for ${identifier}`)
    }
  }

  export async function cleanupTerminal(identifiers: string[], config: SymphonyConfig): Promise<void> {
    for (const identifier of identifiers) {
      try {
        await cleanup(identifier, config)
      } catch (e) {
        log.error(`Failed to cleanup workspace for ${identifier}`, { error: e })
      }
    }
  }
}
