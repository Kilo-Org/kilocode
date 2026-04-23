import { describe, it, expect, vi, beforeEach, type Mock } from "vitest"

// Mock vscode following the pattern from AutocompleteServiceManager.spec.ts
vi.mock("vscode", () => {
  const disposable = { dispose: vi.fn() }

  return {
    commands: {
      registerCommand: vi.fn((_command: string, _callback: (...args: any[]) => any) => disposable),
    },
    window: {
      showErrorMessage: vi.fn(),
      withProgress: vi.fn(),
    },
    workspace: {
      workspaceFolders: [
        {
          uri: { fsPath: "/test/workspace" },
        },
      ],
    },
    extensions: {
      getExtension: vi.fn(),
    },
    ProgressLocation: {
      SourceControl: 1,
    },
    Uri: {
      parse: (s: string) => ({ fsPath: s }),
    },
  }
})

import * as vscode from "vscode"
import { registerCommitMessageService } from "../index"
import type { KiloConnectionService } from "../../cli-backend/connection-service"

describe("commit-message service", () => {
  let mockContext: vscode.ExtensionContext
  let mockConnectionService: KiloConnectionService
  let mockClient: { commitMessage: { generate: Mock } }

  beforeEach(() => {
    vi.clearAllMocks()

    mockContext = {
      subscriptions: [],
    } as any

    mockClient = {
      commitMessage: {
        generate: vi.fn().mockResolvedValue({ data: { message: "feat: add new feature" } }),
      },
    }

    mockConnectionService = {
      getClientAsync: vi.fn().mockResolvedValue(mockClient),
    } as any
  })

  describe("registerCommitMessageService", () => {
    it("returns an array of disposables", () => {
      const disposables = registerCommitMessageService(mockContext, mockConnectionService)

      expect(Array.isArray(disposables)).toBe(true)
      expect(disposables.length).toBeGreaterThan(0)
    })

    it("registers the kilo-code.new.generateCommitMessage command", () => {
      registerCommitMessageService(mockContext, mockConnectionService)

      expect(vscode.commands.registerCommand).toHaveBeenCalledWith(
        "kilo-code.new.generateCommitMessage",
        expect.any(Function),
      )
    })

    it("pushes the command disposable to context.subscriptions", () => {
      registerCommitMessageService(mockContext, mockConnectionService)

      expect(mockContext.subscriptions.length).toBe(1)
    })
  })

  describe("command execution", () => {
    let commandCallback: (...args: any[]) => Promise<void>

    beforeEach(() => {
      registerCommitMessageService(mockContext, mockConnectionService)

      // Extract the registered command callback
      const registerCall = (vscode.commands.registerCommand as Mock).mock.calls[0]!
      commandCallback = registerCall[1] as (...args: any[]) => Promise<void>
    })

    it("shows error when git extension is not found", async () => {
      ;(vscode.extensions.getExtension as Mock).mockReturnValue(undefined)

      await commandCallback()

      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith("Git extension not found")
    })

    it("shows error when no git repository is found", async () => {
      ;(vscode.extensions.getExtension as Mock).mockReturnValue({
        isActive: true,
        activate: vi.fn().mockResolvedValue(undefined),
        exports: {
          getAPI: () => ({ repositories: [] }),
        },
      })

      await commandCallback()

      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith("No Git repository found")
    })

    it("shows error when backend fails to connect", async () => {
      ;(vscode.extensions.getExtension as Mock).mockReturnValue({
        isActive: true,
        activate: vi.fn().mockResolvedValue(undefined),
        exports: {
          getAPI: () => ({
            repositories: [{ inputBox: { value: "" }, rootUri: { fsPath: "/repo" } }],
          }),
        },
      })
      ;(mockConnectionService.getClientAsync as Mock).mockRejectedValue(new Error("Connect failed"))

      await commandCallback()

      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
        "Failed to connect to Kilo backend. Please try again.",
      )
    })

    it("auto-connects backend and generates message when client not yet ready", async () => {
      const mockInputBox = { value: "" }
      ;(vscode.extensions.getExtension as Mock).mockReturnValue({
        isActive: true,
        activate: vi.fn().mockResolvedValue(undefined),
        exports: {
          getAPI: () => ({
            repositories: [{ inputBox: mockInputBox, rootUri: { fsPath: "/auto-connect-repo" } }],
          }),
        },
      })

      const mockToken = { onCancellationRequested: vi.fn() }
      ;(vscode.window.withProgress as Mock).mockImplementation(async (_options: any, task: any) => {
        await task({}, mockToken)
      })

      await commandCallback()

      expect(mockConnectionService.getClientAsync).toHaveBeenCalled()
      expect(mockInputBox.value).toBe("feat: add new feature")
    })

    it("calls commitMessage.generate on the SDK client with repository root path", async () => {
      const mockInputBox = { value: "" }
      ;(vscode.extensions.getExtension as Mock).mockReturnValue({
        isActive: true,
        activate: vi.fn().mockResolvedValue(undefined),
        exports: {
          getAPI: () => ({
            repositories: [{ inputBox: mockInputBox, rootUri: { fsPath: "/repo" } }],
          }),
        },
      })

      const mockToken = { onCancellationRequested: vi.fn() }
      ;(vscode.window.withProgress as Mock).mockImplementation(async (_options: any, task: any) => {
        await task({}, mockToken)
      })

      await commandCallback()

      expect(mockClient.commitMessage.generate).toHaveBeenCalledWith(
        { path: "/repo", selectedFiles: undefined, previousMessage: undefined },
        expect.objectContaining({ throwOnError: true }),
      )
    })

    it("sets the generated message on the repository inputBox", async () => {
      const mockInputBox = { value: "" }
      ;(vscode.extensions.getExtension as Mock).mockReturnValue({
        isActive: true,
        activate: vi.fn().mockResolvedValue(undefined),
        exports: {
          getAPI: () => ({
            repositories: [{ inputBox: mockInputBox, rootUri: { fsPath: "/repo" } }],
          }),
        },
      })

      const mockToken = { onCancellationRequested: vi.fn() }
      ;(vscode.window.withProgress as Mock).mockImplementation(async (_options: any, task: any) => {
        await task({}, mockToken)
      })

      await commandCallback()

      expect(mockInputBox.value).toBe("feat: add new feature")
    })

    it("shows cancellable progress in SourceControl location", async () => {
      const mockInputBox = { value: "" }
      ;(vscode.extensions.getExtension as Mock).mockReturnValue({
        isActive: true,
        activate: vi.fn().mockResolvedValue(undefined),
        exports: {
          getAPI: () => ({
            repositories: [{ inputBox: mockInputBox, rootUri: { fsPath: "/repo" } }],
          }),
        },
      })

      const mockToken = { onCancellationRequested: vi.fn() }
      ;(vscode.window.withProgress as Mock).mockImplementation(async (_options: any, task: any) => {
        await task({}, mockToken)
      })

      await commandCallback()

      expect(vscode.window.withProgress).toHaveBeenCalledWith(
        expect.objectContaining({
          location: vscode.ProgressLocation.SourceControl,
          title: "Generating commit message...",
          cancellable: true,
        }),
        expect.any(Function),
      )
    })

    it("uses the matching repository when SourceControl arg is provided", async () => {
      const mainInputBox = { value: "" }
      const worktreeInputBox = { value: "" }
      vi.mocked(vscode.extensions.getExtension).mockReturnValue({
        isActive: true,
        activate: vi.fn().mockResolvedValue(undefined),
        exports: {
          getAPI: () => ({
            repositories: [
              { inputBox: mainInputBox, rootUri: { fsPath: "/main-repo" } },
              { inputBox: worktreeInputBox, rootUri: { fsPath: "/worktree-repo" } },
            ],
          }),
        },
      } as any)

      vi.mocked(vscode.window.withProgress).mockImplementation(async (_options, task) => {
        await task({} as any, { onCancellationRequested: vi.fn() } as any)
      })

      // Simulate SCM title/input passing the SourceControl for the worktree repo
      const scmArg = { rootUri: { fsPath: "/worktree-repo" } } as vscode.SourceControl
      await commandCallback(scmArg)

      // The worktree repo's inputBox should be updated, not the main repo's
      expect(worktreeInputBox.value).toBe("feat: add new feature")
      expect(mainInputBox.value).toBe("")
    })

    it("falls back to first repository when SourceControl arg has no match", async () => {
      const mainInputBox = { value: "" }
      vi.mocked(vscode.extensions.getExtension).mockReturnValue({
        isActive: true,
        activate: vi.fn().mockResolvedValue(undefined),
        exports: {
          getAPI: () => ({
            repositories: [{ inputBox: mainInputBox, rootUri: { fsPath: "/main-repo" } }],
          }),
        },
      } as any)

      vi.mocked(vscode.window.withProgress).mockImplementation(async (_options, task) => {
        await task({} as any, { onCancellationRequested: vi.fn() } as any)
      })

      const scmArg = { rootUri: { fsPath: "/nonexistent-repo" } } as vscode.SourceControl
      await commandCallback(scmArg)

      expect(mainInputBox.value).toBe("feat: add new feature")
    })
  })
})
