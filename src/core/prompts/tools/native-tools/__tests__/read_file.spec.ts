import type OpenAI from "openai"
import { createReadFileTool } from "../read_file"

// Helper type to access function tools
type FunctionTool = OpenAI.Chat.ChatCompletionTool & { type: "function" }

// Helper to get function definition from tool
const getFunctionDef = (tool: OpenAI.Chat.ChatCompletionTool) => (tool as FunctionTool).function

describe("createReadFileTool", () => {
	describe("single-file-per-call documentation", () => {
		it("should indicate single-file-per-call and suggest parallel tool calls", () => {
			const tool = createReadFileTool()
			const description = getFunctionDef(tool).description

			expect(description).toContain("exactly one file per call")
			expect(description).toContain("multiple parallel read_file calls")
		})
	})

	describe("indentation mode", () => {
		it("should always include indentation mode in description", () => {
			const tool = createReadFileTool()
			const description = getFunctionDef(tool).description

			expect(description).toContain("indentation")
		})

		it("should always include indentation parameter in schema", () => {
			const tool = createReadFileTool()
			const schema = getFunctionDef(tool).parameters as any

			expect(schema.properties).toHaveProperty("indentation")
		})

		it("should include mode parameter in schema", () => {
			const tool = createReadFileTool()
			const schema = getFunctionDef(tool).parameters as any

			expect(schema.properties).toHaveProperty("mode")
			expect(schema.properties.mode.enum).toContain("slice")
			expect(schema.properties.mode.enum).toContain("indentation")
		})

		it("should include offset and limit parameters in schema", () => {
			const tool = createReadFileTool()
			const schema = getFunctionDef(tool).parameters as any

			expect(schema.properties).toHaveProperty("offset")
			expect(schema.properties).toHaveProperty("limit")
		})
	})

	describe("supportsImages option", () => {
		it("should include image format documentation when supportsImages is true", () => {
			const tool = createReadFileTool({ supportsImages: true })
			const description = getFunctionDef(tool).description

			expect(description).toContain(
				"Automatically processes and returns image files (PNG, JPG, JPEG, GIF, BMP, SVG, WEBP, ICO, AVIF) for visual analysis",
			)
		})

		it("should not include image format documentation when supportsImages is false", () => {
			const tool = createReadFileTool({ supportsImages: false })
			const description = getFunctionDef(tool).description

			expect(description).not.toContain(
				"Automatically processes and returns image files (PNG, JPG, JPEG, GIF, BMP, SVG, WEBP, ICO, AVIF) for visual analysis",
			)
			expect(description).toContain("may not handle other binary files properly")
		})

		it("should default supportsImages to false", () => {
			const tool = createReadFileTool({})
			const description = getFunctionDef(tool).description

			expect(description).not.toContain(
				"Automatically processes and returns image files (PNG, JPG, JPEG, GIF, BMP, SVG, WEBP, ICO, AVIF) for visual analysis",
			)
		})

		it("should always include PDF and DOCX support in description", () => {
			const toolWithImages = createReadFileTool({ supportsImages: true })
			const toolWithoutImages = createReadFileTool({ supportsImages: false })

			expect(getFunctionDef(toolWithImages).description).toContain(
				"Supports text extraction from PDF and DOCX files",
			)
			expect(getFunctionDef(toolWithoutImages).description).toContain(
				"Supports text extraction from PDF and DOCX files",
			)
		})
	})

	describe("tool structure", () => {
		it("should have correct tool name", () => {
			const tool = createReadFileTool()

			expect(getFunctionDef(tool).name).toBe("read_file")
		})

		it("should be a function type tool", () => {
			const tool = createReadFileTool()

			expect(tool.type).toBe("function")
		})

		it("should have strict mode enabled", () => {
			const tool = createReadFileTool()

			expect(getFunctionDef(tool).strict).toBe(true)
		})

		it("should require path parameter", () => {
			const tool = createReadFileTool()
			const schema = getFunctionDef(tool).parameters as any

			expect(schema.required).toContain("path")
		})
	})
})
