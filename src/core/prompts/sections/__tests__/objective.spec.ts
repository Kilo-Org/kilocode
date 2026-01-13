// Mock ManagedIndexer before importing anything that uses it
vi.mock("../../../../services/code-index/managed/ManagedIndexer", () => ({
	ManagedIndexer: {
		getInstance: vi.fn().mockReturnValue({
			isEnabled: vi.fn().mockReturnValue(false),
			organization: null,
		}),
	},
}))

import { getObjectiveSection } from "../objective"

describe("getObjectiveSection", () => {
	it("should include proper numbered structure", () => {
		const objective = getObjectiveSection()

		// Check that all numbered items are present
		expect(objective).toContain("1. Analyze the user's task")
		expect(objective).toContain("2. Work through these goals sequentially")
		expect(objective).toContain("3. Remember, you have extensive capabilities")
		expect(objective).toContain("4. Once you've completed the user's task")
		expect(objective).toContain("5. The user may provide feedback")
	})

	it("should include analysis guidance", () => {
		const objective = getObjectiveSection()

		expect(objective).toContain("Before calling a tool, do some analysis")
		expect(objective).toContain("analyze the file structure provided in environment_details")
		expect(objective).toContain("think about which of the provided tools is the most relevant")
	})

	it("should include parameter inference guidance", () => {
		const objective = getObjectiveSection()

		expect(objective).toContain("Go through each of the required parameters")
		expect(objective).toContain(
			"determine if the user has directly provided or given enough information to infer a value",
		)
		expect(objective).toContain("DO NOT invoke the tool (not even with fillers for the missing params)")
		expect(objective).toContain("ask_followup_question tool")
	})

	it("should include guidance about not engaging in back and forth conversations", () => {
		const objective = getObjectiveSection()

		expect(objective).toContain("DO NOT continue in pointless back and forth conversations")
		expect(objective).toContain("don't end your responses with questions or offers for further assistance")
	})

	it("should include the OBJECTIVE header", () => {
		const objective = getObjectiveSection()

		expect(objective).toContain("OBJECTIVE")
		expect(objective).toContain("You accomplish a given task iteratively")
	})
})
