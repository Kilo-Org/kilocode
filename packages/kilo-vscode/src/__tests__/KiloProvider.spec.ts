import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("vscode", () => ({
  env: {
    appName: "VS Code",
    isTelemetryEnabled: true,
    machineId: "machine-id",
    language: "en",
  },
  version: "1.0.0",
  extensions: {
    getExtension: vi.fn().mockReturnValue({
      packageJSON: { version: "7.1.3" },
    }),
  },
  workspace: {
    getConfiguration: vi.fn().mockReturnValue({
      get: vi.fn(),
    }),
    workspaceFolders: [{ uri: { fsPath: "/repo" } }],
  },
  commands: {
    executeCommand: vi.fn(),
  },
  window: {},
}))

vi.mock("../image-preview", () => ({
  buildPreviewPath: vi.fn(),
  getPreviewCommand: vi.fn(),
  getPreviewDir: vi.fn(),
  parseImage: vi.fn(),
  trimEntries: vi.fn((x: unknown) => x),
}))

vi.mock("../path-utils", () => ({
  isAbsolutePath: vi.fn(),
}))

vi.mock("../services/cli-backend", () => ({
  ServerStartupError: class extends Error {
    userMessage = "error"
    userDetails = "details"
  },
}))

vi.mock("../services/autocomplete/shims/FileIgnoreController", () => ({
  FileIgnoreController: class {
    dispose() {}
  },
}))

vi.mock("../services/autocomplete/chat-autocomplete/ChatTextAreaAutocomplete", () => ({
  ChatTextAreaAutocomplete: class {
    dispose() {}
  },
}))

vi.mock("../utils", () => ({
  buildWebviewHtml: vi.fn(() => "<html></html>"),
}))

vi.mock("../services/telemetry", () => ({
  TelemetryProxy: {
    getInstance: () => ({
      setProvider: vi.fn(),
    }),
  },
}))

vi.mock("../kilo-provider-utils", () => ({
  sessionToWebview: vi.fn((x: unknown) => x),
  indexProvidersById: vi.fn(),
  filterVisibleAgents: vi.fn(() => []),
  buildSettingPath: vi.fn(),
  mapSSEEventToWebviewMessage: vi.fn(),
  getErrorMessage: vi.fn((err: unknown) => String(err)),
  isEventFromForeignProject: vi.fn(() => false),
  loadSessions: vi.fn(),
  flushPendingSessionRefresh: vi.fn(),
}))

vi.mock("../services/marketplace", () => ({
  MarketplaceService: class {
    dispose() {}
  },
}))

vi.mock("../project-directory", () => ({
  resolveProjectDirectory: vi.fn(),
}))

vi.mock("../session-status", () => ({
  getBusySessionCount: vi.fn(() => 0),
  seedSessionStatuses: vi.fn(),
}))

vi.mock("../kilo-provider/slim-metadata", () => ({
  slimPart: vi.fn((x: unknown) => x),
  slimParts: vi.fn((x: unknown) => x),
}))

vi.mock("../kilo-provider/handlers/migration", () => ({
  checkAndShowMigrationWizard: vi.fn(),
  handleRequestLegacyMigrationData: vi.fn(),
  handleStartLegacyMigration: vi.fn(),
  handleSkipLegacyMigration: vi.fn(),
  handleClearLegacyData: vi.fn(),
}))

vi.mock("../kilo-provider/handlers/auth", () => ({
  handleLogin: vi.fn(),
  handleLogout: vi.fn(),
  handleSetOrganization: vi.fn(),
  handleRefreshProfile: vi.fn(),
}))

vi.mock("../kilo-provider/handlers/cloud-session", () => ({
  handleRequestCloudSessions: vi.fn(),
  handleRequestCloudSessionData: vi.fn(),
  handleImportAndSend: vi.fn(),
}))

vi.mock("../kilo-provider/handlers/permission-handler", () => ({
  handlePermissionResponse: vi.fn(),
  fetchAndSendPendingPermissions: vi.fn(),
}))

vi.mock("../kilo-provider/handlers/question", () => ({
  handleQuestionReply: vi.fn(),
  handleQuestionReject: vi.fn(),
}))

vi.mock("../provider-actions", () => ({
  buildActionContext: vi.fn(),
  computeDefaultSelection: vi.fn(),
  fetchProviderData: vi.fn(),
  validateRecents: vi.fn(),
  connectProvider: vi.fn(),
  authorizeProviderOAuth: vi.fn(),
  completeProviderOAuth: vi.fn(),
  disconnectProvider: vi.fn(),
  saveCustomProvider: vi.fn(),
}))

import { KiloProvider } from "../KiloProvider"
import type { KiloConnectionService } from "../services/cli-backend"
import type { Uri } from "vscode"

function createConnection() {
  return {
    getClient: vi.fn(() => {
      throw new Error("not connected")
    }),
  } as unknown as KiloConnectionService
}

describe("KiloProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("disposes into a terminal state and drops late postMessage calls", () => {
    const uri = {} as Uri
    const provider = new KiloProvider(uri, createConnection())
    const webview = {
      postMessage: vi.fn().mockResolvedValue(true),
    }
    const abort = new AbortController()

    ;(provider as any).webview = webview
    ;(provider as any).isWebviewReady = true
    ;(provider as any).loadMessagesAbort = abort
    ;(provider as any).onBeforeMessage = vi.fn()
    ;(provider as any).pendingReviewComments = [{ comments: [], autoSend: false }]
    ;(provider as any).readyResolvers = [vi.fn()]

    provider.dispose()
    provider.postMessage({ type: "late" })

    expect(abort.signal.aborted).toBe(true)
    expect((provider as any).disposed).toBe(true)
    expect((provider as any).isWebviewReady).toBe(false)
    expect((provider as any).loadMessagesAbort).toBeNull()
    expect((provider as any).webview).toBeNull()
    expect((provider as any).onBeforeMessage).toBeNull()
    expect((provider as any).pendingReviewComments).toEqual([])
    expect((provider as any).readyResolvers).toEqual([])
    expect(webview.postMessage).not.toHaveBeenCalled()
  })
})
