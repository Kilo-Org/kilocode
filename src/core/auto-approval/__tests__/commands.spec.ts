// kilocode_change - new file
import { getCommandDecision } from "../commands"

describe("getCommandDecision", () => {
	describe("piped commands with redirections", () => {
		it("should auto-approve piped command when allowlist contains redirection pattern", () => {
			// When the allowlist contains "pnpm compile 2>&1" and "head",
			// the command "pnpm compile 2>&1 | head -100" should be auto-approved
			const allowedCommands = ["pnpm compile 2>&1", "head"]
			const deniedCommands: string[] = []

			const result = getCommandDecision("pnpm compile 2>&1 | head -100", allowedCommands, deniedCommands)

			expect(result).toBe("auto_approve")
		})

		it("should auto-approve when allowlist has command without redirection and command uses redirection", () => {
			// When the allowlist contains "pnpm compile" (without redirection),
			// the command "pnpm compile 2>&1 | head -100" should still be auto-approved
			// because stripping the redirection from the command should match the allowlist
			const allowedCommands = ["pnpm compile", "head"]
			const deniedCommands: string[] = []

			const result = getCommandDecision("pnpm compile 2>&1 | head -100", allowedCommands, deniedCommands)

			expect(result).toBe("auto_approve")
		})
	})
})
