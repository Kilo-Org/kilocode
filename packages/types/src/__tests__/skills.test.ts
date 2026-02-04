import {
	validateSkillName,
	SkillNameValidationError,
	SKILL_NAME_MIN_LENGTH,
	SKILL_NAME_MAX_LENGTH,
	SKILL_NAME_REGEX,
} from "../skills.js"

describe("validateSkillName", () => {
	describe("valid names", () => {
		it("accepts single lowercase word", () => {
			expect(validateSkillName("myskill")).toEqual({ valid: true })
		})

		it("accepts lowercase letters and numbers", () => {
			expect(validateSkillName("skill123")).toEqual({ valid: true })
		})

		it("accepts hyphenated words", () => {
			expect(validateSkillName("my-skill")).toEqual({ valid: true })
		})

		it("accepts multiple hyphenated words", () => {
			expect(validateSkillName("my-awesome-skill")).toEqual({ valid: true })
		})

		it("accepts single character", () => {
			expect(validateSkillName("a")).toEqual({ valid: true })
		})

		it("accepts single digit", () => {
			expect(validateSkillName("1")).toEqual({ valid: true })
		})

		it("accepts maximum length name (64 characters)", () => {
			const maxLengthName = "a".repeat(SKILL_NAME_MAX_LENGTH)
			expect(validateSkillName(maxLengthName)).toEqual({ valid: true })
		})
	})

	describe("empty or missing names", () => {
		it("rejects empty string", () => {
			expect(validateSkillName("")).toEqual({
				valid: false,
				error: SkillNameValidationError.Empty,
			})
		})
	})

	describe("names that are too long", () => {
		it("rejects names longer than 64 characters", () => {
			const tooLongName = "a".repeat(SKILL_NAME_MAX_LENGTH + 1)
			expect(validateSkillName(tooLongName)).toEqual({
				valid: false,
				error: SkillNameValidationError.TooLong,
			})
		})
	})

	describe("invalid format", () => {
		it("rejects uppercase letters", () => {
			expect(validateSkillName("MySkill")).toEqual({
				valid: false,
				error: SkillNameValidationError.InvalidFormat,
			})
		})

		it("rejects leading hyphen", () => {
			expect(validateSkillName("-myskill")).toEqual({
				valid: false,
				error: SkillNameValidationError.InvalidFormat,
			})
		})

		it("rejects trailing hyphen", () => {
			expect(validateSkillName("myskill-")).toEqual({
				valid: false,
				error: SkillNameValidationError.InvalidFormat,
			})
		})

		it("rejects consecutive hyphens", () => {
			expect(validateSkillName("my--skill")).toEqual({
				valid: false,
				error: SkillNameValidationError.InvalidFormat,
			})
		})

		it("rejects spaces", () => {
			expect(validateSkillName("my skill")).toEqual({
				valid: false,
				error: SkillNameValidationError.InvalidFormat,
			})
		})

		it("rejects underscores", () => {
			expect(validateSkillName("my_skill")).toEqual({
				valid: false,
				error: SkillNameValidationError.InvalidFormat,
			})
		})

		it("rejects special characters", () => {
			expect(validateSkillName("my@skill")).toEqual({
				valid: false,
				error: SkillNameValidationError.InvalidFormat,
			})
		})

		it("rejects dots", () => {
			expect(validateSkillName("my.skill")).toEqual({
				valid: false,
				error: SkillNameValidationError.InvalidFormat,
			})
		})
	})
})

describe("SKILL_NAME_REGEX", () => {
	it("matches valid names", () => {
		expect(SKILL_NAME_REGEX.test("myskill")).toBe(true)
		expect(SKILL_NAME_REGEX.test("my-skill")).toBe(true)
		expect(SKILL_NAME_REGEX.test("skill123")).toBe(true)
		expect(SKILL_NAME_REGEX.test("a1-b2-c3")).toBe(true)
	})

	it("does not match invalid names", () => {
		expect(SKILL_NAME_REGEX.test("-start")).toBe(false)
		expect(SKILL_NAME_REGEX.test("end-")).toBe(false)
		expect(SKILL_NAME_REGEX.test("double--hyphen")).toBe(false)
		expect(SKILL_NAME_REGEX.test("UPPER")).toBe(false)
		expect(SKILL_NAME_REGEX.test("")).toBe(false)
	})
})

describe("constants", () => {
	it("has correct min length", () => {
		expect(SKILL_NAME_MIN_LENGTH).toBe(1)
	})

	it("has correct max length", () => {
		expect(SKILL_NAME_MAX_LENGTH).toBe(64)
	})
})
