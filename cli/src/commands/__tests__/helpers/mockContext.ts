/**
 * Test helper for creating mock CommandContext
 *
 * This utility provides a reusable mock context for command tests,
 * eliminating the need to duplicate the same mock setup across multiple test files.
 *
 * @example
 * ```typescript
 * import { createMockContext } from "./helpers/mockContext.js"
 *
 * const mockContext = createMockContext({
 *   input: "/clear",
 *   addMessage: vi.fn(),
 * })
 * ```
 */

import { vi } from "vitest"
import type { CommandContext } from "../../core/types.js"
import type { CLIConfig } from "../../../config/types.js"

/**
 * Creates a mock CommandContext with all required properties.
 * All functions are mocked with vi.fn() and return appropriate default values.
 *
 * @param overrides - Partial context to override default values
 * @returns A complete mock CommandContext with all required properties
 */
export function createMockContext(overrides: Partial<CommandContext> = {}): CommandContext {
	const defaultContext: CommandContext = {
		input: "",
		args: [],
		options: {},
		config: {} as CLIConfig,
		sendMessage: vi.fn().mockResolvedValue(undefined),
		addMessage: vi.fn(),
		clearMessages: vi.fn(),
		replaceMessages: vi.fn(),
		setMessageCutoffTimestamp: vi.fn(),
		clearTask: vi.fn().mockResolvedValue(undefined),
		setMode: vi.fn(),
		setTheme: vi.fn().mockResolvedValue(undefined),
		exit: vi.fn(),
		setCommittingParallelMode: vi.fn(),
		isParallelMode: false,
		routerModels: null,
		currentProvider: null,
		kilocodeDefaultModel: "",
		updateProviderModel: vi.fn().mockResolvedValue(undefined),
		refreshRouterModels: vi.fn().mockResolvedValue(undefined),
		updateProvider: vi.fn().mockResolvedValue(undefined),
		selectProvider: vi.fn().mockResolvedValue(undefined),
		profileData: null,
		balanceData: null,
		profileLoading: false,
		balanceLoading: false,
		customModes: [],
		refreshTerminal: vi.fn().mockResolvedValue(undefined),
		taskHistoryData: null,
		taskHistoryFilters: {
			workspace: "current",
			sort: "newest",
			favoritesOnly: false,
		},
		taskHistoryLoading: false,
		taskHistoryError: null,
		fetchTaskHistory: vi.fn().mockResolvedValue(undefined),
		updateTaskHistoryFilters: vi.fn().mockResolvedValue(null),
		changeTaskHistoryPage: vi.fn().mockResolvedValue(null),
		nextTaskHistoryPage: vi.fn().mockResolvedValue(null),
		previousTaskHistoryPage: vi.fn().mockResolvedValue(null),
		sendWebviewMessage: vi.fn().mockResolvedValue(undefined),
		chatMessages: [],
		// Current task context
		currentTask: null,
		modelListPageIndex: 0,
		modelListFilters: {
			sort: "preferred",
			capabilities: [],
		},
		updateModelListFilters: vi.fn(),
		changeModelListPage: vi.fn(),
		resetModelListState: vi.fn(),
	}

	return {
		...defaultContext,
		...overrides,
	}
}
