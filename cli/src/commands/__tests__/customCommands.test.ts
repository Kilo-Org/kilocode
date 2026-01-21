import { describe, it, expect, vi } from "vitest"
import { executeCustomSlashCommand } from "../../services/customSlashCommands.js"
import type { CustomSlashCommandDefinition } from "../../services/customSlashCommands.js"
import { createMockContext } from "./helpers/mockContext.js"
import type { ExtensionChatMessage } from "../../types/messages.js"
import type { ProviderConfig } from "../../config/types.js"

const buildDefinition = (overrides: Partial<CustomSlashCommandDefinition> = {}): CustomSlashCommandDefinition => ({
	name: "audit",
	description: "Audit command",
	body: "Review $ARGUMENTS",
	metadata: {
		scope: "project",
		sourcePath: "/tmp/audit.md",
		argumentHint: "<path>",
		allowedTools: [{ type: "read", raw: "Read" }],
		model: undefined,
		disableModelInvocation: undefined,
	},
	...overrides,
})

describe("custom slash command execution", () => {
	it("sends newTask when no active chat messages", async () => {
		const sendWebviewMessage = vi.fn().mockResolvedValue(undefined)
		const setSlashCommandPolicy = vi.fn()

		const context = createMockContext({
			args: ["src"],
			chatMessages: [],
			sendWebviewMessage,
			setSlashCommandPolicy,
		})

		await executeCustomSlashCommand(buildDefinition(), context)

		expect(setSlashCommandPolicy).toHaveBeenCalled()
		expect(sendWebviewMessage).toHaveBeenCalledWith({
			type: "newTask",
			text: "Review src",
		})
	})

	it("sends askResponse when chat messages exist", async () => {
		const sendWebviewMessage = vi.fn().mockResolvedValue(undefined)

		const context = createMockContext({
			args: ["src", "utils"],
			chatMessages: [{ type: "say", ts: Date.now() } as ExtensionChatMessage],
			sendWebviewMessage,
		})

		await executeCustomSlashCommand(buildDefinition(), context)

		expect(sendWebviewMessage).toHaveBeenCalledWith({
			type: "askResponse",
			askResponse: "messageResponse",
			text: "Review src utils",
		})
	})

	it("applies model override and queues restore", async () => {
		const sendWebviewMessage = vi.fn().mockResolvedValue(undefined)
		const updateProviderModel = vi.fn().mockResolvedValue(undefined)
		const setPendingModelOverride = vi.fn()

		const currentProvider = {
			id: "provider-1",
			provider: "kilocode",
			kilocodeModel: "old-model",
		} as ProviderConfig

		const context = createMockContext({
			args: [],
			chatMessages: [],
			sendWebviewMessage,
			updateProviderModel,
			setPendingModelOverride,
			currentProvider,
		})

		await executeCustomSlashCommand(
			buildDefinition({
				metadata: {
					...buildDefinition().metadata,
					model: "new-model",
				},
			}),
			context,
		)

		expect(setPendingModelOverride).toHaveBeenCalled()
		expect(updateProviderModel).toHaveBeenCalledWith("new-model")
	})
})
