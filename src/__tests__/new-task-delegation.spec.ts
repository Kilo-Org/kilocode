// npx vitest run __tests__/new-task-delegation.spec.ts

import { describe, it, expect, vi } from "vitest"
import { RooCodeEventName } from "@roo-code/types"
import { Task } from "../core/task/Task"

describe("Task.startSubtask() metadata-driven delegation", () => {
	it("Routes to provider.delegateParentAndOpenChild without pausing parent", async () => {
		const provider = {
			getState: vi.fn().mockResolvedValue({
				experiments: {},
			}),
			delegateParentAndOpenChild: vi.fn().mockResolvedValue({ taskId: "child-1" }),
			createTask: vi.fn(),
			handleModeSwitch: vi.fn(),
		} as any

		// Create a minimal Task-like instance with only fields used by startSubtask
		const parent = Object.create(Task.prototype) as Task
		;(parent as any).taskId = "parent-1"
		;(parent as any).providerRef = { deref: () => provider }
		;(parent as any).emit = vi.fn()

		const child = await (Task.prototype as any).startSubtask.call(parent, "Do something", [], "code")

		expect(provider.delegateParentAndOpenChild).toHaveBeenCalledWith({
			parentTaskId: "parent-1",
			message: "Do something",
			initialTodos: [],
			mode: "code",
		})
		expect(child.taskId).toBe("child-1")

		// Parent should not be paused and no paused/unpaused events should be emitted
		expect((parent as any).isPaused).not.toBe(true)
		expect((parent as any).childTaskId).toBeUndefined()
		const emittedEvents = (parent.emit as any).mock.calls.map((c: any[]) => c[0])
		expect(emittedEvents).not.toContain(RooCodeEventName.TaskPaused)
		expect(emittedEvents).not.toContain(RooCodeEventName.TaskUnpaused)

		// Legacy path not used
		expect(provider.createTask).not.toHaveBeenCalled()
	})
})
