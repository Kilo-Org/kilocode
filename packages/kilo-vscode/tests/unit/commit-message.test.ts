import { beforeEach, describe, expect, it, mock, spyOn } from "bun:test"
import * as vscode from "vscode"

// Augment the shared vscode preload with the bits the service uses. Using spyOn
// keeps the override local — a whole mock.module("vscode", ...) would leak into
// every other test file.
let lastRegistration: { command: string; cb: (...args: unknown[]) => unknown } | null = null
const registerCommand = spyOn(vscode.commands, "registerCommand").mockImplementation((command: string, cb: unknown) => {
  lastRegistration = { command, cb: cb as (...args: unknown[]) => unknown }
  return { dispose: mock() }
})
const showErrorMessage = spyOn(vscode.window, "showErrorMessage").mockImplementation(
  () => Promise.resolve(undefined) as ReturnType<typeof vscode.window.showErrorMessage>,
)
const withProgress = spyOn(vscode.window, "withProgress").mockImplementation(
  async (_options: unknown, task: (...args: unknown[]) => unknown) => {
    await task({}, { onCancellationRequested: mock() })
    return undefined as never
  },
)
const getExtension = spyOn(vscode.extensions, "getExtension").mockImplementation(() => undefined)

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
    getExtension.mockReset().mockImplementation(() => undefined)
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

      expect(registerCommand).toHaveBeenCalledWith("kilo-code.new.generateCommitMessage", expect.any(Function))
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
      getExtension.mockImplementation(() => undefined)

      await invoke()

      expect(showErrorMessage).toHaveBeenCalledWith("Git extension not found")
    })

    it("shows error when no git repository is found", async () => {
      getExtension.mockImplementation(() => makeExtension([]) as never)

      await invoke()

      expect(showErrorMessage).toHaveBeenCalledWith("No Git repository found")
    })

    it("shows error when backend fails to connect", async () => {
      getExtension.mockImplementation(
        () => makeExtension([{ inputBox: { value: "" }, rootUri: { fsPath: "/repo" } }]) as never,
      )
      connection.getClientAsync = mock(() => Promise.reject(new Error("Connect failed")))

      await invoke()

      expect(showErrorMessage).toHaveBeenCalledWith("Failed to connect to Kilo backend. Please try again.")
    })

    it("auto-connects backend and generates message when client not yet ready", async () => {
      const inputBox = { value: "" }
      getExtension.mockImplementation(
        () => makeExtension([{ inputBox, rootUri: { fsPath: "/auto-connect-repo" } }]) as never,
      )

      await invoke()

      expect(connection.getClientAsync).toHaveBeenCalled()
      expect(inputBox.value).toBe("feat: add new feature")
    })

    it("calls commitMessage.generate on the SDK client with repository root path", async () => {
      const inputBox = { value: "" }
      getExtension.mockImplementation(() => makeExtension([{ inputBox, rootUri: { fsPath: "/repo" } }]) as never)

      await invoke()

      expect(client.commitMessage.generate).toHaveBeenCalledWith(
        { path: "/repo", selectedFiles: undefined, previousMessage: undefined },
        expect.objectContaining({ throwOnError: true }),
      )
    })

    it("sets the generated message on the repository inputBox", async () => {
      const inputBox = { value: "" }
      getExtension.mockImplementation(() => makeExtension([{ inputBox, rootUri: { fsPath: "/repo" } }]) as never)

      await invoke()

      expect(inputBox.value).toBe("feat: add new feature")
    })

    it("shows cancellable progress in SourceControl location", async () => {
      const inputBox = { value: "" }
      getExtension.mockImplementation(() => makeExtension([{ inputBox, rootUri: { fsPath: "/repo" } }]) as never)

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
      getExtension.mockImplementation(
        () =>
          makeExtension([
            { inputBox: main, rootUri: { fsPath: "/main-repo" } },
            { inputBox: worktree, rootUri: { fsPath: "/worktree-repo" } },
          ]) as never,
      )

      await invoke({ rootUri: { fsPath: "/worktree-repo" } })

      expect(worktree.value).toBe("feat: add new feature")
      expect(main.value).toBe("")
    })

    it("falls back to first repository when SourceControl arg has no match", async () => {
      const main = { value: "" }
      getExtension.mockImplementation(
        () => makeExtension([{ inputBox: main, rootUri: { fsPath: "/main-repo" } }]) as never,
      )

      await invoke({ rootUri: { fsPath: "/nonexistent-repo" } })

      expect(main.value).toBe("feat: add new feature")
    })
  })
})
