// The Generate Commit Message command of the source control view. It asks the `kilocode.commit-message` RPC for a
// message for the repository of the clicked view (or the first repository) and writes it into that repository's
// input box through the `vscode.git` API. The VS Code API arrives as `host`, so the flow is testable without VS Code.
import { OpenCode } from "@opencode/client"
import { KiloCommitMessageRpc } from "@opencode/schema/kilocode/commit-message"
import type { CancellationToken, Progress, ProgressLocation, ProgressOptions, SourceControl } from "vscode"
import { local } from "./local"
import type { Manager } from "./server"
import { normalizeLocale } from "./shared/locale"

/** The client-side limit: a little longer than the 30 seconds of the server, so the server can answer first. */
export const TIMEOUT = 35_000

export interface GitRepository {
  inputBox: { value: string }
  rootUri: { fsPath: string }
}

export interface GitExports {
  getAPI(version: 1): { repositories: GitRepository[] }
}

export interface GitExtension {
  isActive: boolean
  activate(): Thenable<unknown>
  exports?: GitExports
}

export type Generate = (input: KiloCommitMessageRpc.Input, signal: AbortSignal) => Promise<{ message: string }>

export interface CommitMessageHost {
  /** `extensions.getExtension("vscode.git")`. */
  git: () => GitExtension | undefined
  window: {
    showErrorMessage(message: string): unknown
    withProgress<R>(
      options: ProgressOptions,
      task: (progress: Progress<{ message?: string }>, token: CancellationToken) => Thenable<R>,
    ): Thenable<R>
  }
  /** `ProgressLocation.SourceControl`. */
  location: ProgressLocation
  /** The locale of the message. */
  language: () => string
  connect: () => Promise<Generate>
  log?: (text: string) => void
}

/**
 * The command handler. VS Code passes the source control of the clicked view title or input box. `timeout` is the
 * client-side limit in milliseconds.
 */
export function commitMessageCommand(host: CommitMessageHost, timeout = TIMEOUT) {
  // The last message per repository, so a second click asks for a different one.
  const last: { path?: string; message?: string } = {}
  return async (arg?: Pick<SourceControl, "rootUri">) => {
    const extension = host.git()
    if (!extension) return void host.window.showErrorMessage("Git extension not found")
    if (!extension.isActive) await extension.activate()
    const repository = findRepository(extension.exports?.getAPI(1).repositories ?? [], arg)
    if (!repository) return void host.window.showErrorMessage("No Git repository found")
    const path = repository.rootUri.fsPath

    const generate = await host.connect().catch((error: unknown) => {
      host.log?.(`Commit message: could not connect to the Kilo server: ${errorMessage(error)}`)
      return undefined
    })
    if (!generate) return void host.window.showErrorMessage("Failed to connect to Kilo backend. Please try again.")

    const state = { cancelled: false, timedOut: false }
    const controller = new AbortController()
    await Promise.resolve(
      host.window.withProgress(
        { location: host.location, title: "Generating commit message...", cancellable: true },
        async (_progress, token) => {
          token.onCancellationRequested(() => {
            state.cancelled = true
            controller.abort()
          })
          const timer = setTimeout(() => {
            state.timedOut = true
            controller.abort()
          }, timeout)
          try {
            const result = await generate(
              {
                path,
                previousMessage: last.path === path ? last.message : undefined,
                language: host.language(),
              },
              controller.signal,
            )
            repository.inputBox.value = result.message
            last.path = path
            last.message = result.message
          } finally {
            clearTimeout(timer)
          }
        },
      ),
    ).catch((error: unknown) => {
      if (state.cancelled) return
      if (state.timedOut) return void host.window.showErrorMessage("Commit message generation timed out. Please try again.")
      const message = errorMessage(error)
      host.log?.(`Commit message: ${message}`)
      host.window.showErrorMessage(message || "Failed to generate commit message. Please try again.")
    })
  }
}

/** The repository of the clicked source control view, else the first repository. */
export function findRepository(repositories: GitRepository[], arg?: Pick<SourceControl, "rootUri">) {
  const target = arg?.rootUri?.fsPath
  return repositories.find((repository) => target && repository.rootUri.fsPath === target) ?? repositories[0]
}

/**
 * The locale of the message: `kilo-code.v2.languageCommitMessage`, or with `sync` (the default) the UI language, which
 * is `kilo-code.v2.language` when set and the VS Code display language otherwise.
 */
export function commitMessageLanguage(setting: unknown, ui: unknown, display: string) {
  if (typeof setting === "string" && setting && setting !== "sync") return normalizeLocale(setting)
  return normalizeLocale(typeof ui === "string" && ui ? ui : display)
}

/** Generates through the extension's Kilo server, starting it when it does not run yet. */
export async function connect(server: Pick<Manager, "get">): Promise<Generate> {
  const target = await server.get()
  const rpc = OpenCode.make({ baseUrl: target.url, headers: { authorization: target.authorization }, fetch: local }).rpc(
    KiloCommitMessageRpc.Definition,
  )
  return (input, signal) => rpc.generate(input, { location: { directory: input.path }, signal })
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  if (typeof error === "object" && error !== null && "message" in error && typeof error.message === "string")
    return error.message
  return typeof error === "string" ? error : ""
}
