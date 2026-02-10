import { normalizeCreateRunForSubmit } from "../normalize-create-run"

describe("normalizeCreateRunForSubmit", () => {
	it("uses selectedExercises for partial suite", () => {
		const result = normalizeCreateRunForSubmit(
			{
				model: "roo/model-a",
				description: "",
				suite: "partial",
				exercises: [],
				settings: undefined,
				concurrency: 1,
				timeout: 5,
				iterations: 1,
				jobToken: "",
				executionMethod: "vscode",
			},
			["js/foo", "py/bar"],
		)

		expect(result.suite).toBe("partial")
		expect(result.exercises).toEqual(["js/foo", "py/bar"])
	})

	it("dedupes selectedExercises for partial suite", () => {
		const result = normalizeCreateRunForSubmit(
			{
				model: "roo/model-a",
				description: "",
				suite: "partial",
				exercises: [],
				settings: undefined,
				concurrency: 1,
				timeout: 5,
				iterations: 1,
				jobToken: "",
				executionMethod: "vscode",
			},
			["js/foo", "js/foo", "py/bar"],
		)

		expect(result.exercises).toEqual(["js/foo", "py/bar"])
	})

	it("clears exercises for full suite", () => {
		const result = normalizeCreateRunForSubmit(
			{
				model: "roo/model-a",
				description: "",
				suite: "full",
				exercises: ["js/foo"],
				settings: undefined,
				concurrency: 1,
				timeout: 5,
				iterations: 1,
				jobToken: "",
				executionMethod: "vscode",
			},
			["js/foo"],
		)

		expect(result.suite).toBe("full")
		expect(result.exercises).toEqual([])
	})
})
