/**
 * Tests for the built-in skills generation script validation logic.
 *
 * Note: These tests focus on the validation functions since the main script
 * is designed to be run as a CLI tool. The actual generation is tested
 * via the integration with the build process.
 */

describe("generate-built-in-skills validation", () => {
	describe("validateSkillName", () => {
		// Validation function extracted from the generation script
		function validateSkillName(name: string): string[] {
			const errors: string[] = []

			if (name.length < 1 || name.length > 64) {
				errors.push(`Name must be 1-64 characters (got ${name.length})`)
			}

			const nameFormat = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
			if (!nameFormat.test(name)) {
				errors.push(
					"Name must be lowercase letters/numbers/hyphens only (no leading/trailing hyphen, no consecutive hyphens)",
				)
			}

			return errors
		}

		it("should accept valid skill names", () => {
			expect(validateSkillName("mcp-builder")).toHaveLength(0)
			expect(validateSkillName("create-mode")).toHaveLength(0)
			expect(validateSkillName("pdf-processing")).toHaveLength(0)
			expect(validateSkillName("a")).toHaveLength(0)
			expect(validateSkillName("skill123")).toHaveLength(0)
			expect(validateSkillName("my-skill-v2")).toHaveLength(0)
		})

		it("should reject names with uppercase letters", () => {
			const errors = validateSkillName("Create-MCP-Server")
			expect(errors).toHaveLength(1)
			expect(errors[0]).toContain("lowercase")
		})

		it("should reject names with leading hyphen", () => {
			const errors = validateSkillName("-my-skill")
			expect(errors).toHaveLength(1)
			expect(errors[0]).toContain("leading/trailing hyphen")
		})

		it("should reject names with trailing hyphen", () => {
			const errors = validateSkillName("my-skill-")
			expect(errors).toHaveLength(1)
			expect(errors[0]).toContain("leading/trailing hyphen")
		})

		it("should reject names with consecutive hyphens", () => {
			const errors = validateSkillName("my--skill")
			expect(errors).toHaveLength(1)
			expect(errors[0]).toContain("consecutive hyphens")
		})

		it("should reject empty names", () => {
			const errors = validateSkillName("")
			expect(errors.length).toBeGreaterThan(0)
		})

		it("should reject names longer than 64 characters", () => {
			const longName = "a".repeat(65)
			const errors = validateSkillName(longName)
			expect(errors).toHaveLength(1)
			expect(errors[0]).toContain("1-64 characters")
		})

		it("should reject names with special characters", () => {
			expect(validateSkillName("my_skill").length).toBeGreaterThan(0)
			expect(validateSkillName("my.skill").length).toBeGreaterThan(0)
			expect(validateSkillName("my skill").length).toBeGreaterThan(0)
		})
	})

	describe("validateDescription", () => {
		// Validation function extracted from the generation script
		function validateDescription(description: string): string[] {
			const errors: string[] = []
			const trimmed = description.trim()

			if (trimmed.length < 1 || trimmed.length > 1024) {
				errors.push(`Description must be 1-1024 characters (got ${trimmed.length})`)
			}

			return errors
		}

		it("should accept valid descriptions", () => {
			expect(validateDescription("A short description")).toHaveLength(0)
			expect(validateDescription("x")).toHaveLength(0)
			expect(validateDescription("x".repeat(1024))).toHaveLength(0)
		})

		it("should reject empty descriptions", () => {
			const errors = validateDescription("")
			expect(errors).toHaveLength(1)
			expect(errors[0]).toContain("1-1024 characters")
		})

		it("should reject whitespace-only descriptions", () => {
			const errors = validateDescription("   ")
			expect(errors).toHaveLength(1)
			expect(errors[0]).toContain("got 0")
		})

		it("should reject descriptions longer than 1024 characters", () => {
			const longDesc = "x".repeat(1025)
			const errors = validateDescription(longDesc)
			expect(errors).toHaveLength(1)
			expect(errors[0]).toContain("got 1025")
		})
	})

	describe("escapeForTemplateLiteral", () => {
		// Escape function extracted from the generation script
		function escapeForTemplateLiteral(str: string): string {
			return str.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${")
		}

		it("should escape backticks", () => {
			expect(escapeForTemplateLiteral("code `example`")).toBe("code \\`example\\`")
		})

		it("should escape template literal interpolation", () => {
			expect(escapeForTemplateLiteral("value: ${foo}")).toBe("value: \\${foo}")
		})

		it("should escape backslashes", () => {
			expect(escapeForTemplateLiteral("path\\to\\file")).toBe("path\\\\to\\\\file")
		})

		it("should handle combined escapes", () => {
			const input = "const x = `${value}`"
			const expected = "const x = \\`\\${value}\\`"
			expect(escapeForTemplateLiteral(input)).toBe(expected)
		})
	})
})

describe("built-in skills integration", () => {
	it("should have valid skill names matching directory names", async () => {
		// Import the generated built-in skills
		const { getBuiltInSkills, getBuiltInSkillContent } = await import("../built-in-skills")

		const skills = getBuiltInSkills()

		// Verify we have the expected skills
		const skillNames = skills.map((s) => s.name)
		expect(skillNames).toContain("create-mcp-server")
		expect(skillNames).toContain("create-mode")

		// Verify each skill has valid content
		for (const skill of skills) {
			expect(skill.source).toBe("built-in")
			expect(skill.path).toBe("built-in")

			const content = getBuiltInSkillContent(skill.name)
			expect(content).not.toBeNull()
			expect(content!.instructions.length).toBeGreaterThan(0)
		}
	})

	it("should return null for non-existent skills", async () => {
		const { getBuiltInSkillContent } = await import("../built-in-skills")

		const content = getBuiltInSkillContent("non-existent-skill")
		expect(content).toBeNull()
	})
})
