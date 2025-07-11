import { extractCommandPattern, formatCommandPatternForDisplay } from "../commandPattern"

describe("commandPattern", () => {
	describe("extractCommandPattern", () => {
		it("should extract base command patterns correctly", () => {
			expect(extractCommandPattern("wc -l foo.txt")).toBe("wc -l")
			expect(extractCommandPattern("cd /path/to/project && npm install")).toBe("cd && npm install")
			expect(extractCommandPattern("git status")).toBe("git status")
			expect(extractCommandPattern("ls -la /some/path")).toBe("ls -la")
			expect(extractCommandPattern("npm test -- --coverage")).toBe("npm test")
		})

		it("should handle complex chained commands", () => {
			expect(extractCommandPattern("cd /project && npm install && npm test")).toBe(
				"cd && npm install && npm test",
			)
			expect(extractCommandPattern('git add . && git commit -m "message" && git push')).toBe(
				"git add && git commit -m && git push",
			)
		})

		it("should preserve important flags but remove file paths", () => {
			expect(extractCommandPattern("docker run -it --rm ubuntu:latest")).toBe("docker run -it --rm")
			expect(extractCommandPattern('find /path -name "*.js" -type f')).toBe("find -name -type f")
		})
	})

	describe("formatCommandPatternForDisplay", () => {
		it("should format patterns for display correctly", () => {
			expect(formatCommandPatternForDisplay("wc -l")).toBe('"wc -l"')
			expect(formatCommandPatternForDisplay("cd && npm install")).toBe('"cd && npm install"')
			expect(formatCommandPatternForDisplay("git status")).toBe('"git status"')
		})
	})
})
