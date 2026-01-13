// npx vitest run __tests__/delegation-events.spec.ts

import { RooCodeEventName, rooCodeEventsSchema, taskEventSchema } from "@roo-code/types"

describe("delegation event schemas", () => {
	test("rooCodeEventsSchema validates tuples", () => {
		expect(() => (rooCodeEventsSchema.shape as any)[RooCodeEventName.TaskDelegated].parse(["p", "c"])).not.toThrow()
		expect(() =>
			(rooCodeEventsSchema.shape as any)[RooCodeEventName.TaskDelegationCompleted].parse(["p", "c", "s"]),
		).not.toThrow()
		expect(() =>
			(rooCodeEventsSchema.shape as any)[RooCodeEventName.TaskDelegationResumed].parse(["p", "c"]),
		).not.toThrow()

		// invalid shapes
		expect(() => (rooCodeEventsSchema.shape as any)[RooCodeEventName.TaskDelegated].parse(["p"])).toThrow()
		expect(() =>
			(rooCodeEventsSchema.shape as any)[RooCodeEventName.TaskDelegationCompleted].parse(["p", "c"]),
		).toThrow()
		expect(() => (rooCodeEventsSchema.shape as any)[RooCodeEventName.TaskDelegationResumed].parse(["p"])).toThrow()
	})

	test("taskEventSchema discriminated union includes delegation events", () => {
		expect(() =>
			taskEventSchema.parse({
				eventName: RooCodeEventName.TaskDelegated,
				payload: ["p", "c"],
				taskId: 1,
			}),
		).not.toThrow()

		expect(() =>
			taskEventSchema.parse({
				eventName: RooCodeEventName.TaskDelegationCompleted,
				payload: ["p", "c", "s"],
				taskId: 1,
			}),
		).not.toThrow()

		expect(() =>
			taskEventSchema.parse({
				eventName: RooCodeEventName.TaskDelegationResumed,
				payload: ["p", "c"],
				taskId: 1,
			}),
		).not.toThrow()
	})
})
