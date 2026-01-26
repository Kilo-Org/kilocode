import * as assert from "assert"

import { RooCodeEventName, type ClineMessage } from "@roo-code/types"

import { waitFor } from "./utils"

suite("Kilo Code Subtasks", () => {
	test("Should create and complete a subtask successfully", async function () {
		this.timeout(180_000) // 3 minutes for complex orchestration
		const api = globalThis.api

		const messages: ClineMessage[] = []
		let childTaskCompleted = false
		let parentCompleted = false

		// Listen for messages to detect subtask result
		const messageHandler = ({ message }: { message: ClineMessage }) => {
			messages.push(message)

			// Log completion messages
			if (message.type === "say" && message.say === "completion_result") {
				console.log("Completion result:", message.text?.substring(0, 100))
			}
		}
		api.on(RooCodeEventName.Message, messageHandler)

		// Listen for task completion
		const completionHandler = (taskId: string) => {
			if (taskId === parentTaskId) {
				parentCompleted = true
				console.log("✓ Parent task completed")
			} else {
				childTaskCompleted = true
				console.log("✓ Child task completed:", taskId)
			}
		}
		api.on(RooCodeEventName.TaskCompleted, completionHandler)

		const childPrompt = "What is 2 + 2? Respond with just the number."

		// Start a parent task that will create a subtask
		console.log("Starting parent task that will spawn subtask...")
		const parentTaskId = await api.startNewTask({
			configuration: {
				mode: "code",
				alwaysAllowModeSwitch: true,
				alwaysAllowSubtasks: true,
				autoApprovalEnabled: true,
				enableCheckpoints: false,
			},
			text: `Create a subtask using the new_task tool with this message: "${childPrompt}". Wait for the subtask to complete, then tell me the result.`,
		})

		try {
			// Wait for child task to complete
			console.log("Waiting for child task to complete...")
			await waitFor(() => childTaskCompleted, { timeout: 90_000 })
			console.log("✓ Child task completed")

			// Wait for parent to complete
			console.log("Waiting for parent task to complete...")
			await waitFor(() => parentCompleted, { timeout: 90_000 })
			console.log("✓ Parent task completed")

			// Verify the parent task mentions the subtask result (should contain "4")
			const hasSubtaskResult = messages.some(
				(m) =>
					m.type === "say" &&
					m.say === "completion_result" &&
					m.text?.includes("4") &&
					m.text?.toLowerCase().includes("subtask"),
			)

			// Verify all events occurred
			assert.ok(childTaskCompleted, "Child task should have completed")
			assert.ok(parentCompleted, "Parent task should have completed")
			assert.ok(hasSubtaskResult, "Parent task should mention the subtask result")

			console.log("Test passed! Subtask orchestration working correctly")
		} finally {
			// Clean up
			api.off(RooCodeEventName.Message, messageHandler)
			api.off(RooCodeEventName.TaskCompleted, completionHandler)

			// Cancel any remaining tasks
			try {
				await api.cancelCurrentTask()
			} catch {
				// Task might already be complete
			}
		}
	})
})
