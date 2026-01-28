import { RooCodeSettings } from "@roo-code/types"

import { useCLIStore } from "../store.js"

describe("useCLIStore", () => {
	beforeEach(() => {
		// Reset store to initial state before each test
		useCLIStore.getState().reset()
	})

	describe("initialState", () => {
		it("should have isResumingTask set to false initially", () => {
			const state = useCLIStore.getState()
			expect(state.isResumingTask).toBe(false)
		})

		it("should have empty messages array initially", () => {
			const state = useCLIStore.getState()
			expect(state.messages).toEqual([])
		})

		it("should have empty taskHistory initially", () => {
			const state = useCLIStore.getState()
			expect(state.taskHistory).toEqual([])
		})
	})

	describe("setIsResumingTask", () => {
		it("should set isResumingTask to true", () => {
			useCLIStore.getState().setIsResumingTask(true)
			expect(useCLIStore.getState().isResumingTask).toBe(true)
		})

		it("should set isResumingTask to false", () => {
			useCLIStore.getState().setIsResumingTask(true)
			useCLIStore.getState().setIsResumingTask(false)
			expect(useCLIStore.getState().isResumingTask).toBe(false)
		})
	})

	describe("reset", () => {
		it("should reset all state to initial values", () => {
			// Set some state first
			const store = useCLIStore.getState()
			store.addMessage({ id: "1", role: "user", content: "test" })
			store.setTaskHistory([{ id: "task1", task: "test", workspace: "/test", ts: Date.now() }])
			store.setAvailableModes([{ key: "code", slug: "code", name: "Code" }])
			store.setAllSlashCommands([{ key: "test", name: "test", source: "global" as const }])
			store.setIsResumingTask(true)
			store.setLoading(true)
			store.setHasStartedTask(true)

			// Reset
			useCLIStore.getState().reset()

			// Verify all state is reset
			const resetState = useCLIStore.getState()
			expect(resetState.messages).toEqual([])
			expect(resetState.taskHistory).toEqual([])
			expect(resetState.availableModes).toEqual([])
			expect(resetState.allSlashCommands).toEqual([])
			expect(resetState.isResumingTask).toBe(false)
			expect(resetState.isLoading).toBe(false)
			expect(resetState.hasStartedTask).toBe(false)
		})
	})

	describe("resetForTaskSwitch", () => {
		it("should clear task-specific state", () => {
			// Set up task-specific state
			const store = useCLIStore.getState()
			store.addMessage({ id: "1", role: "user", content: "test" })
			store.setLoading(true)
			store.setComplete(true)
			store.setHasStartedTask(true)
			store.setError("some error")
			store.setIsResumingTask(true)
			store.setTokenUsage({
				totalTokensIn: 100,
				totalTokensOut: 50,
				totalCost: 0.01,
				contextTokens: 0,
				totalCacheReads: 0,
				totalCacheWrites: 0,
			})
			store.setTodos([{ id: "1", content: "test todo", status: "pending" }])

			// Reset for task switch
			useCLIStore.getState().resetForTaskSwitch()

			// Verify task-specific state is cleared
			const resetState = useCLIStore.getState()
			expect(resetState.messages).toEqual([])
			expect(resetState.pendingAsk).toBeNull()
			expect(resetState.isLoading).toBe(false)
			expect(resetState.isComplete).toBe(false)
			expect(resetState.hasStartedTask).toBe(false)
			expect(resetState.error).toBeNull()
			expect(resetState.isResumingTask).toBe(false)
			expect(resetState.tokenUsage).toBeNull()
			expect(resetState.currentTodos).toEqual([])
			expect(resetState.previousTodos).toEqual([])
		})

		it("should PRESERVE taskHistory", () => {
			const taskHistory = [
				{ id: "task1", task: "test task 1", workspace: "/test", ts: Date.now() },
				{ id: "task2", task: "test task 2", workspace: "/test", ts: Date.now() },
			]
			useCLIStore.getState().setTaskHistory(taskHistory)

			useCLIStore.getState().resetForTaskSwitch()

			expect(useCLIStore.getState().taskHistory).toEqual(taskHistory)
		})

		it("should PRESERVE availableModes", () => {
			const modes = [
				{ key: "code", slug: "code", name: "Code", description: "Code mode" },
				{ key: "architect", slug: "architect", name: "Architect", description: "Architect mode" },
			]
			useCLIStore.getState().setAvailableModes(modes)

			useCLIStore.getState().resetForTaskSwitch()

			expect(useCLIStore.getState().availableModes).toEqual(modes)
		})

		it("should PRESERVE allSlashCommands", () => {
			const commands = [
				{ key: "new", name: "new", description: "New task", source: "global" as const },
				{ key: "help", name: "help", description: "Get help", source: "built-in" as const },
			]
			useCLIStore.getState().setAllSlashCommands(commands)

			useCLIStore.getState().resetForTaskSwitch()

			expect(useCLIStore.getState().allSlashCommands).toEqual(commands)
		})

		it("should PRESERVE fileSearchResults", () => {
			const results = [
				{ key: "file1", path: "file1.ts", type: "file" as const },
				{ key: "file2", path: "file2.ts", type: "file" as const },
			]
			useCLIStore.getState().setFileSearchResults(results)

			useCLIStore.getState().resetForTaskSwitch()

			expect(useCLIStore.getState().fileSearchResults).toEqual(results)
		})

		it("should PRESERVE currentMode", () => {
			useCLIStore.getState().setCurrentMode("architect")

			useCLIStore.getState().resetForTaskSwitch()

			expect(useCLIStore.getState().currentMode).toBe("architect")
		})

		it("should PRESERVE routerModels", () => {
			const models = { openai: { "gpt-4": { contextWindow: 128000 } } }
			useCLIStore.getState().setRouterModels(models)

			useCLIStore.getState().resetForTaskSwitch()

			expect(useCLIStore.getState().routerModels).toEqual(models)
		})

		it("should PRESERVE apiConfiguration", () => {
			const config: RooCodeSettings = { apiProvider: "openai", apiModelId: "gpt-4" }

			useCLIStore
				.getState()
				.setApiConfiguration(config as ReturnType<typeof useCLIStore.getState>["apiConfiguration"])

			useCLIStore.getState().resetForTaskSwitch()

			expect(useCLIStore.getState().apiConfiguration).toEqual(config)
		})
	})

	describe("task resumption flow", () => {
		it("should support the full task resumption workflow", () => {
			const store = useCLIStore.getState

			// Step 1: Initial state with task history and modes from webviewDidLaunch.
			store().setTaskHistory([{ id: "task1", task: "Previous task", workspace: "/test", ts: Date.now() }])
			store().setAvailableModes([{ key: "code", slug: "code", name: "Code" }])
			store().setAllSlashCommands([{ key: "new", name: "new", source: "global" as const }])

			// Step 2: User starts a new task.
			store().setHasStartedTask(true)
			store().addMessage({ id: "1", role: "user", content: "New task" })
			store().addMessage({ id: "2", role: "assistant", content: "Working on it..." })
			store().setLoading(true)

			// Verify current state.
			expect(store().messages.length).toBe(2)
			expect(store().hasStartedTask).toBe(true)

			// Step 3: User selects a task from history to resume.
			// This triggers resetForTaskSwitch + setIsResumingTask(true).
			store().resetForTaskSwitch()
			store().setIsResumingTask(true)

			// Verify task-specific state is cleared but global state preserved.
			expect(store().messages).toEqual([])
			expect(store().isLoading).toBe(false)
			expect(store().hasStartedTask).toBe(false)
			expect(store().isResumingTask).toBe(true) // Flag is set.
			expect(store().taskHistory.length).toBe(1) // Preserved.
			expect(store().availableModes.length).toBe(1) // Preserved.
			expect(store().allSlashCommands.length).toBe(1) // Preserved.

			// Step 4: Extension sends state message with clineMessages
			// (simulated by adding messages).
			store().addMessage({ id: "old1", role: "user", content: "Previous task prompt" })
			store().addMessage({ id: "old2", role: "assistant", content: "Previous response" })

			// Step 5: After processing state, isResumingTask should be cleared.
			store().setIsResumingTask(false)

			// Final verification.
			expect(store().isResumingTask).toBe(false)
			expect(store().messages.length).toBe(2)
			expect(store().taskHistory.length).toBe(1) // Still preserved.
		})

		it("should allow reading isResumingTask synchronously during message processing", () => {
			const store = useCLIStore.getState

			// Set the flag
			store().setIsResumingTask(true)

			// Simulate synchronous read during message processing
			const isResuming = store().isResumingTask
			expect(isResuming).toBe(true)

			// The handler can use this to decide whether to skip messages
			if (!isResuming) {
				// Would skip first text message for new tasks
			} else {
				// Would NOT skip first text message for resumed tasks
			}

			// After processing, clear the flag
			store().setIsResumingTask(false)
			expect(store().isResumingTask).toBe(false)
		})
	})

	describe("difference between reset and resetForTaskSwitch", () => {
		it("should show that reset clears everything while resetForTaskSwitch preserves global state", () => {
			const store = useCLIStore.getState

			// Set up both task-specific and global state
			store().addMessage({ id: "1", role: "user", content: "test" })
			store().setTaskHistory([{ id: "t1", task: "task", workspace: "/", ts: Date.now() }])
			store().setAvailableModes([{ key: "code", slug: "code", name: "Code" }])

			// Use resetForTaskSwitch
			store().resetForTaskSwitch()

			// Task-specific cleared, global preserved
			expect(store().messages).toEqual([])
			expect(store().taskHistory.length).toBe(1)
			expect(store().availableModes.length).toBe(1)

			// Now use reset()
			store().reset()

			// Everything cleared
			expect(store().messages).toEqual([])
			expect(store().taskHistory).toEqual([])
			expect(store().availableModes).toEqual([])
		})
	})
})
