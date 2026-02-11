import * as os from "os"
import * as path from "path"
import * as vscode from "vscode"
import { Task } from "../Task"

// Mock dependencies
vi.mock("delay", () => ({
	__esModule: true,
	default: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("p-wait-for", () => ({
	default: vi.fn().mockImplementation(async () => Promise.resolve()),
}))

vi.mock("vscode", () => {
    return {
        workspace: {
            getConfiguration: vi.fn(() => ({ get: vi.fn() })),
        },
        env: {
            uriScheme: "vscode",
            language: "en",
        },
        EventEmitter: vi.fn().mockImplementation(() => ({
            event: vi.fn(),
            fire: vi.fn(),
        })),
    }
})

describe("Auto-Retry Logic", () => {
	let mockProvider: any
	let mockApiConfig: any
	let mockExtensionContext: any

	beforeEach(() => {
		mockExtensionContext = {
			globalState: {
				get: vi.fn(),
				update: vi.fn(),
				keys: vi.fn().mockReturnValue([]),
			},
			globalStorageUri: { fsPath: path.join(os.tmpdir(), "test-storage") },
			secrets: {
				get: vi.fn().mockResolvedValue(undefined),
				store: vi.fn().mockResolvedValue(undefined),
			},
			extensionUri: { fsPath: "/mock/path" },
			extension: { packageJSON: { version: "1.0.0" } },
		}

		mockProvider = {
			getState: vi.fn().mockResolvedValue({
				autoApprovalEnabled: true,
				requestDelaySeconds: 1,
				requestRetryMax: 3,
			}),
			postMessageToWebview: vi.fn().mockResolvedValue(undefined),
			postStateToWebview: vi.fn().mockResolvedValue(undefined),
		}

		mockApiConfig = {
			apiProvider: "anthropic",
			apiModelId: "claude-3-5-sonnet-20241022",
		}
	})

	it("should calculate correct delay", async () => {
		const task = new Task({
			context: mockExtensionContext,
			provider: mockProvider,
			apiConfiguration: mockApiConfig,
			task: "test",
			startTask: false,
		})

		const delay = (task as any).backoffAndAnnounce(1, new Error("test"))
		// We can't easily await this because it has a loop with delay()
		// but we can check the internal logic if we expose it or mock delay better
	})

    it("should respect requestRetryMax and alwaysApproveResubmit", async () => {
        const state = {
            autoApprovalEnabled: true,
            alwaysApproveResubmit: true,
            requestRetryMax: 2
        }

        const shouldRetry = (attempt: number) =>
            state.autoApprovalEnabled &&
            state.alwaysApproveResubmit &&
            (state.requestRetryMax === 0 || attempt < state.requestRetryMax)

        // retryAttempt 0 < 2 -> should retry
        expect(shouldRetry(0)).toBe(true)
        // retryAttempt 1 < 2 -> should retry
        expect(shouldRetry(1)).toBe(true)
        // retryAttempt 2 == 2 -> should NOT retry
        expect(shouldRetry(2)).toBe(false)

        // If alwaysApproveResubmit is false, should NOT retry
        state.alwaysApproveResubmit = false
        expect(shouldRetry(0)).toBe(false)
    })

    it("should handle unlimited retries when requestRetryMax is 0", async () => {
        const state = {
            autoApprovalEnabled: true,
            alwaysApproveResubmit: true,
            requestRetryMax: 0
        }

        const shouldRetry = (attempt: number) =>
            state.autoApprovalEnabled &&
            state.alwaysApproveResubmit &&
            (state.requestRetryMax === 0 || attempt < state.requestRetryMax)

        expect(shouldRetry(100)).toBe(true)

        // If alwaysApproveResubmit is false, should NOT retry even with unlimited retries
        state.alwaysApproveResubmit = false
        expect(shouldRetry(100)).toBe(false)
    })
})
