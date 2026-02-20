import { describe, it, expect, vi, beforeEach } from "vitest"

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
  let mockHttpClient: { generateCommitMessage: ReturnType<typeof vi.fn> }

  beforeEach(() => {
    vi.clearAllMocks()

    mockContext = {
      subscriptions: [],
    } as any

    mockHttpClient = {
      generateCommitMessage: vi.fn().mockResolvedValue("feat: add new feature"),
    }

    mockConnectionService = {
      getHttpClient: vi.fn().mockReturnValue(mockHttpClient),
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
      const registerCall = vi.mocked(vscode.commands.registerCommand).mock.calls[0]!
      commandCallback = registerCall[1] as (...args: any[]) => Promise<void>
    })

    it("shows error when git extension is not found", async () => {
      vi.mocked(vscode.extensions.getExtension).mockReturnValue(undefined)

      await commandCallback()

      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith("Git extension not found")
    })

    it("shows error when no git repository is found", async () => {
      vi.mocked(vscode.extensions.getExtension).mockReturnValue({
        isActive: true,
        activate: vi.fn().mockResolvedValue(undefined),
        exports: {
          getAPI: () => ({ repositories: [] }),
        },
      } as any)

      await commandCallback()

      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith("No Git repository found")
    })

    it("shows error when backend is not connected", async () => {
      vi.mocked(vscode.extensions.getExtension).mockReturnValue({
        isActive: true,
        activate: vi.fn().mockResolvedValue(undefined),
        exports: {
          getAPI: () => ({
            repositories: [{ inputBox: { value: "" }, rootUri: { fsPath: "/repo" } }],
          }),
        },
      } as any)
      vi.mocked(mockConnectionService.getHttpClient as any).mockImplementation(() => {
        throw new Error("Not connected")
      })

      await commandCallback()

      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
        "Kilo backend is not connected. Please wait for the connection to establish.",
      )
    })

    it("calls generateCommitMessage on the HTTP client with repository root path", async () => {
      const mockInputBox = { value: "" }
      vi.mocked(vscode.extensions.getExtension).mockReturnValue({
        isActive: true,
        activate: vi.fn().mockResolvedValue(undefined),
        exports: {
          getAPI: () => ({
            repositories: [{ inputBox: mockInputBox, rootUri: { fsPath: "/repo" } }],
          }),
        },
      } as any)

      // Make withProgress execute its callback
      vi.mocked(vscode.window.withProgress).mockImplementation(async (_options, task) => {
        await task({} as any, {} as any)
      })

      await commandCallback()

      expect(mockHttpClient.generateCommitMessage).toHaveBeenCalledWith("/repo", undefined, undefined)
    })

    it("sets the generated message on the repository inputBox", async () => {
      const mockInputBox = { value: "" }
      vi.mocked(vscode.extensions.getExtension).mockReturnValue({
        isActive: true,
        activate: vi.fn().mockResolvedValue(undefined),
        exports: {
          getAPI: () => ({
            repositories: [{ inputBox: mockInputBox, rootUri: { fsPath: "/repo" } }],
          }),
        },
      } as any)

      vi.mocked(vscode.window.withProgress).mockImplementation(async (_options, task) => {
        await task({} as any, {} as any)
      })

      await commandCallback()

      expect(mockInputBox.value).toBe("feat: add new feature")
    })

    it("shows progress in SourceControl location", async () => {
      const mockInputBox = { value: "" }
      vi.mocked(vscode.extensions.getExtension).mockReturnValue({
        isActive: true,
        activate: vi.fn().mockResolvedValue(undefined),
        exports: {
          getAPI: () => ({
            repositories: [{ inputBox: mockInputBox, rootUri: { fsPath: "/repo" } }],
          }),
        },
      } as any)

      vi.mocked(vscode.window.withProgress).mockImplementation(async (_options, task) => {
        await task({} as any, {} as any)
      })

      await commandCallback()

      expect(vscode.window.withProgress).toHaveBeenCalledWith(
        expect.objectContaining({
          location: vscode.ProgressLocation.SourceControl,
          title: "Generating commit message...",
        }),
        expect.any(Function),
      )
    })
  })
})
