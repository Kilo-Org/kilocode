import { beforeEach, describe, expect, it, mock } from "bun:test"

// Hand-rolled vscode shim so we can observe interactions without pulling in
// the shared preload's generic stub (it omits ProgressLocation etc.).
const registerCommand = mock((_command: string, cb: (...args: unknown[]) => unknown) => {
  lastRegistration = { command: _command, cb }
  return { dispose: mock() }
})
const showErrorMessage = mock(() => Promise.resolve(undefined))
const withProgress = mock(async (_options: unknown, task: (...args: unknown[]) => unknown) => {
  await task({}, { onCancellationRequested: mock() })
})
const getExtension = mock(() => undefined)

let lastRegistration: { command: string; cb: (...args: unknown[]) => unknown } | null = null

mock.module("vscode", () => ({
  commands: { registerCommand },
  window: { showErrorMessage, withProgress },
  workspace: { workspaceFolders: [{ uri: { fsPath: "/test/workspace" } }] },
  extensions: { getExtension },
  ProgressLocation: { SourceControl: 1 },
  Uri: { parse: (s: string) => ({ fsPath: s }) },
}))

const vscode = (await import("vscode")) as typeof import("vscode")
const { registerCommitMessageService } = await import("../../src/services/commit-message")

type KiloConnectionService = import("../../src/services/cli-backend/connection-service").KiloConnectionService

function makeExtension(repositories: Array<{ inputBox: { value: string }; rootUri: { fsPath: string } }>) {
  return {
    isActive: true,
    activate: mock(() => Promise.resolve()),
    exports: {
      getAPI: () => ({ repositories }),
    },
  }
}

describe("commit-message service", () => {
  let context: import("vscode").ExtensionContext
  let connection: KiloConnectionService
  let client: { commitMessage: { generate: ReturnType<typeof mock> } }

  beforeEach(() => {
    registerCommand.mockClear()
    showErrorMessage.mockClear()
    withProgress.mockClear()
    getExtension.mockReset()
    lastRegistration = null

    context = { subscriptions: [] } as unknown as import("vscode").ExtensionContext

    client = {
      commitMessage: {
        generate: mock(() => Promise.resolve({ data: { message: "feat: add new feature" } })),
      },
    }

    connection = {
      getClientAsync: mock(() => Promise.resolve(client)),
    } as unknown as KiloConnectionService
  })

  describe("registerCommitMessageService", () => {
    it("returns an array of disposables", () => {
      const disposables = registerCommitMessageService(context, connection)

      expect(Array.isArray(disposables)).toBe(true)
      expect(disposables.length).toBeGreaterThan(0)
    })

    it("registers the kilo-code.new.generateCommitMessage command", () => {
      registerCommitMessageService(context, connection)

      expect(vscode.commands.registerCommand).toHaveBeenCalledWith(
        "kilo-code.new.generateCommitMessage",
        expect.any(Function),
      )
    })

    it("pushes the command disposable to context.subscriptions", () => {
      registerCommitMessageService(context, connection)

      expect(context.subscriptions.length).toBe(1)
    })
  })

  describe("command execution", () => {
    function invoke(...args: unknown[]) {
      registerCommitMessageService(context, connection)
      if (!lastRegistration) throw new Error("command was not registered")
      return lastRegistration.cb(...args) as Promise<void>
    }

    it("shows error when git extension is not found", async () => {
      getExtension.mockReturnValue(undefined)

      await invoke()

      expect(showErrorMessage).toHaveBeenCalledWith("Git extension not found")
    })

    it("shows error when no git repository is found", async () => {
      getExtension.mockReturnValue(makeExtension([]) as unknown as undefined)

      await invoke()

      expect(showErrorMessage).toHaveBeenCalledWith("No Git repository found")
    })

    it("shows error when backend fails to connect", async () => {
      getExtension.mockReturnValue(
        makeExtension([{ inputBox: { value: "" }, rootUri: { fsPath: "/repo" } }]) as unknown as undefined,
      )
      connection.getClientAsync = mock(() => Promise.reject(new Error("Connect failed")))

      await invoke()

      expect(showErrorMessage).toHaveBeenCalledWith("Failed to connect to Kilo backend. Please try again.")
    })

    it("auto-connects backend and generates message when client not yet ready", async () => {
      const inputBox = { value: "" }
      getExtension.mockReturnValue(
        makeExtension([{ inputBox, rootUri: { fsPath: "/auto-connect-repo" } }]) as unknown as undefined,
      )

      await invoke()

      expect(connection.getClientAsync).toHaveBeenCalled()
      expect(inputBox.value).toBe("feat: add new feature")
    })

    it("calls commitMessage.generate on the SDK client with repository root path", async () => {
      const inputBox = { value: "" }
      getExtension.mockReturnValue(makeExtension([{ inputBox, rootUri: { fsPath: "/repo" } }]) as unknown as undefined)

      await invoke()

      expect(client.commitMessage.generate).toHaveBeenCalledWith(
        { path: "/repo", selectedFiles: undefined, previousMessage: undefined },
        expect.objectContaining({ throwOnError: true }),
      )
    })

    it("sets the generated message on the repository inputBox", async () => {
      const inputBox = { value: "" }
      getExtension.mockReturnValue(makeExtension([{ inputBox, rootUri: { fsPath: "/repo" } }]) as unknown as undefined)

      await invoke()

      expect(inputBox.value).toBe("feat: add new feature")
    })

    it("shows cancellable progress in SourceControl location", async () => {
      const inputBox = { value: "" }
      getExtension.mockReturnValue(makeExtension([{ inputBox, rootUri: { fsPath: "/repo" } }]) as unknown as undefined)

      await invoke()

      expect(withProgress).toHaveBeenCalledWith(
        expect.objectContaining({
          location: vscode.ProgressLocation.SourceControl,
          title: "Generating commit message...",
          cancellable: true,
        }),
        expect.any(Function),
      )
    })

    it("uses the matching repository when SourceControl arg is provided", async () => {
      const main = { value: "" }
      const worktree = { value: "" }
      getExtension.mockReturnValue(
        makeExtension([
          { inputBox: main, rootUri: { fsPath: "/main-repo" } },
          { inputBox: worktree, rootUri: { fsPath: "/worktree-repo" } },
        ]) as unknown as undefined,
      )

      await invoke({ rootUri: { fsPath: "/worktree-repo" } })

      expect(worktree.value).toBe("feat: add new feature")
      expect(main.value).toBe("")
    })

    it("falls back to first repository when SourceControl arg has no match", async () => {
      const main = { value: "" }
      getExtension.mockReturnValue(
        makeExtension([{ inputBox: main, rootUri: { fsPath: "/main-repo" } }]) as unknown as undefined,
      )

      await invoke({ rootUri: { fsPath: "/nonexistent-repo" } })

      expect(main.value).toBe("feat: add new feature")
    })
  })
})
