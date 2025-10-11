// @vitest-environment node

/**
 * @fileoverview
 * StreamingToolCallProcessor & handleOpenaiToolCallStreaming 单元测试
 */

import { describe, it, expect, beforeEach } from "vitest"
import { StreamingToolCallProcessor, handleOpenaiToolCallStreaming } from "../tool-call-helper"

describe("StreamingToolCallProcessor", () => {
	let processor: StreamingToolCallProcessor

	beforeEach(() => {
		processor = new StreamingToolCallProcessor()
	})

	it("should process a simple function call with string arguments", () => {
		const chunk = [{ index: 0, id: "1", function: { name: "read_file", arguments: '{"msg":"hello"}' } }]
		const xml = processor.processChunk(chunk)
		expect(xml).toContain("<read_file>")
		expect(xml).toContain("<msg>hello</msg>")
	})

	it("should handle incremental argument streaming", () => {
		const chunk1 = [{ index: 0, id: "1", function: { name: "write_to_file", arguments: '{"a":' } }]
		const chunk2 = [{ index: 0, id: "1", function: { name: "", arguments: '1,"b":2}' } }]
		let xml = processor.processChunk(chunk1)
		expect(xml).toContain("<write_to_file>")
		expect(xml).not.toContain("<a>1</a>")
		xml += processor.processChunk(chunk2)
		expect(xml).toContain("<a>1</a>")
		expect(xml).toContain("<b>2</b>")
		expect(xml).toContain("</write_to_file>")
	})

	it("should finalize incomplete tool calls", () => {
		const chunk = [{ index: 0, id: "1", function: { name: "search_files", arguments: '{"foo":"bar"' } }]
		let finalXml = processor.processChunk(chunk)
		finalXml += processor.finalize()
		expect(finalXml).toContain("<foo>bar</foo>")
		expect(finalXml).toContain("</search_files>")
	})

	it("should reset state", () => {
		const chunk = [{ index: 0, id: "1", function: { name: "list_files", arguments: '{"x":1}' } }]
		processor.processChunk(chunk)
		processor.reset()
		const xml = processor.processChunk(chunk)
		expect(xml).toContain("<list_files>")
		expect(xml).toContain("<x>1</x>")
	})

	it("should handle multiple tool calls (multi-index)", () => {
		const chunk = [
			{ index: 0, id: "1", function: { name: "execute_command", arguments: '{"a":1}' } },
			{ index: 1, id: "2", function: { name: "browser_action", arguments: '{"b":2}' } },
		]
		const xml = processor.processChunk(chunk)
		expect(xml).toContain("<execute_command>")
		expect(xml).toContain("<a>1</a>")
		expect(xml).toContain("<browser_action>")
		expect(xml).toContain("<b>2</b>")
	})

	it("should handle array and nested objects", () => {
		const chunk = [
			{ index: 0, id: "1", function: { name: "use_mcp_tool", arguments: '{"arr":[1,2],"obj":{"k":"v"}}' } },
		]
		const xml = processor.processChunk(chunk)
		expect(xml).toContain("<arr>")
		expect(xml).toContain("<obj>")
		expect(xml).toContain("<k>v</k>")
	})
	it("should handle deeply nested and mixed arrays/objects", () => {
		const chunk = [
			{
				index: 0,
				id: "1",
				function: {
					name: "access_mcp_resource",
					arguments: '{"level1":{"level2":{"arr":[{"x":1},{"y":[2,3,{"z":"end"}]}],"val":42},"emptyArr":[]}}',
				},
			},
		]
		const xml = processor.processChunk(chunk)
		expect(xml).toContain("<level1>")
		expect(xml).toContain("<level2>")
		expect(xml).toContain("<arr>")
		expect(xml).toContain("<x>1</x>")
		expect(xml).toContain("<y>")
		expect(xml).toContain("<z>end</z>")
		expect(xml).toContain("<val>42</val>")
		expect(xml).toContain("<emptyArr>")
	})

	it("should handle incomplete deeply nested JSON streamed in multiple chunks", () => {
		const chunk1 = [
			{
				index: 0,
				id: "1",
				function: {
					name: "ask_followup_question",
					arguments: '{"foo":{"bar":[{"baz":1},',
				},
			},
		]
		const chunk2 = [
			{
				index: 0,
				id: "1",
				function: {
					name: "",
					arguments: '{"baz":2},{"baz":3}]}, "tail":',
				},
			},
		]
		const chunk3 = [
			{
				index: 0,
				id: "1",
				function: {
					name: "",
					arguments: '"done"',
				},
			},
		]
		let xml = processor.processChunk(chunk1)
		expect(xml).toContain("<ask_followup_question>")
		expect(xml).toContain("<foo>")
		expect(xml).toContain("<bar>")
		expect(xml).toContain("<baz>1</baz>")
		expect(xml).not.toContain("<baz>2</baz>")
		xml += processor.processChunk(chunk2)
		expect(xml).toContain("<baz>2</baz>")
		expect(xml).toContain("<baz>3</baz>")
		xml += processor.processChunk(chunk3)
		expect(xml).toContain("<tail>done</tail>")
		expect(xml).not.toContain("</ask_followup_question>")
		xml += processor.finalize()
		expect(xml).toContain("</ask_followup_question>")
	})

	it("should handle invalid JSON gracefully", () => {
		const chunk = [{ index: 0, id: "1", function: { name: "attempt_completion", arguments: '{"a":' } }]
		expect(() => processor.processChunk(chunk)).not.toThrow()
		expect(() => processor.finalize()).not.toThrow()
	})

	it("should process read_file complete arguments", () => {
		const chunk = [
			{
				index: 0,
				id: "1",
				function: {
					name: "read_file",
					arguments: '{"args":{"file":[{"path":"abc/a/b/a.js"},{"path":"abc/c.js"}]}}',
				},
			},
		]
		const xml = processor.processChunk(chunk)
		expect(xml.trim()).toBe(`<read_file>
<args>
	<file>
		<path>abc/a/b/a.js</path>
	</file>
	<file>
		<path>abc/c.js</path>
	</file>
</args>
</read_file>`)
	})

	it("should handle read_file tool calls", () => {
		let xml = ""
		xml += processor.processChunk([
			{
				index: 0,
				id: "call_0_e4d7cf16-74e9-423a-bde5-47bb309978d5",
				type: "function",
				function: { name: "read_file", arguments: "" },
			},
		])
		xml += processor.processChunk([{ index: 0, function: { arguments: '{"' } }])
		xml += processor.processChunk([{ index: 0, function: { arguments: "args" } }])
		xml += processor.processChunk([{ index: 0, function: { arguments: '":{"' } }])
		xml += processor.processChunk([{ index: 0, function: { arguments: "file" } }])
		xml += processor.processChunk([{ index: 0, function: { arguments: '":[' } }])
		xml += processor.processChunk([{ index: 0, function: { arguments: '{"' } }])
		xml += processor.processChunk([{ index: 0, function: { arguments: "path" } }])
		xml += processor.processChunk([{ index: 0, function: { arguments: '":"' } }])
		xml += processor.processChunk([{ index: 0, function: { arguments: "abc" } }])
		xml += processor.processChunk([{ index: 0, function: { arguments: "/a" } }])
		xml += processor.processChunk([{ index: 0, function: { arguments: "/b" } }])
		xml += processor.processChunk([{ index: 0, function: { arguments: "/a" } }])
		xml += processor.processChunk([{ index: 0, function: { arguments: ".js" } }])
		xml += processor.processChunk([{ index: 0, function: { arguments: '"},' } }])
		xml += processor.processChunk([{ index: 0, function: { arguments: '{"' } }])
		xml += processor.processChunk([{ index: 0, function: { arguments: "path" } }])
		xml += processor.processChunk([{ index: 0, function: { arguments: '":"' } }])
		xml += processor.processChunk([{ index: 0, function: { arguments: "abc" } }])
		xml += processor.processChunk([{ index: 0, function: { arguments: "/c" } }])
		xml += processor.processChunk([{ index: 0, function: { arguments: ".js" } }])
		xml += processor.processChunk([{ index: 0, function: { arguments: '"' } }])
		xml += processor.processChunk([{ index: 0, function: { arguments: "}]" } }])
		xml += processor.processChunk([{ index: 0, function: { arguments: "}}" } }])
		expect(xml.trim()).toBe(`<read_file>
<args>
	<file>
		<path>abc/a/b/a.js</path>
	</file>
	<file>
		<path>abc/c.js</path>
	</file>
</args>
</read_file>`)
	})

	it("should handle write_to_file tool calls", () => {
		let xml = ""
		xml += processor.processChunk([
			{
				index: 0,
				id: "call_0_37f0c076-2c5f-4af0-b16b-cf6c0d7479f3",
				type: "function",
				function: { name: "write_to_file", arguments: "" },
			},
		])

		xml += processor.processChunk([{ index: 0, function: { arguments: '{"' } }])
		xml += processor.processChunk([{ index: 0, function: { arguments: "path" } }])
		xml += processor.processChunk([{ index: 0, function: { arguments: '":"' } }])
		xml += processor.processChunk([{ index: 0, function: { arguments: "abc" } }])
		xml += processor.processChunk([{ index: 0, function: { arguments: "/a" } }])
		xml += processor.processChunk([{ index: 0, function: { arguments: "/b" } }])
		xml += processor.processChunk([{ index: 0, function: { arguments: "/a" } }])
		xml += processor.processChunk([{ index: 0, function: { arguments: ".js" } }])
		xml += processor.processChunk([{ index: 0, function: { arguments: '","' } }])
		xml += processor.processChunk([{ index: 0, function: { arguments: "content" } }])
		xml += processor.processChunk([{ index: 0, function: { arguments: '":"' } }])
		xml += processor.processChunk([{ index: 0, function: { arguments: "//" } }])
		xml += processor.processChunk([{ index: 0, function: { arguments: " Function" } }])
		expect(xml).toContain(" Function")
		xml += processor.processChunk([{ index: 0, function: { arguments: " to" } }])
		xml += processor.processChunk([{ index: 0, function: { arguments: " add" } }])
		xml += processor.processChunk([{ index: 0, function: { arguments: " two" } }])
		xml += processor.processChunk([{ index: 0, function: { arguments: " numbers" } }])
		xml += processor.processChunk([{ index: 0, function: { arguments: "\\n" } }])
		xml += processor.processChunk([{ index: 0, function: { arguments: "function" } }])
		xml += processor.processChunk([{ index: 0, function: { arguments: " add" } }])
		xml += processor.processChunk([{ index: 0, function: { arguments: "Numbers" } }])
		expect(xml).toContain(" addNumbers")
		xml += processor.processChunk([{ index: 0, function: { arguments: "(a" } }])
		xml += processor.processChunk([{ index: 0, function: { arguments: "," } }])
		xml += processor.processChunk([{ index: 0, function: { arguments: " b" } }])
		xml += processor.processChunk([{ index: 0, function: { arguments: ")" } }])
		xml += processor.processChunk([{ index: 0, function: { arguments: " {\\" } }])
		xml += processor.processChunk([{ index: 0, function: { arguments: "n" } }])
		xml += processor.processChunk([{ index: 0, function: { arguments: "   " } }])
		xml += processor.processChunk([{ index: 0, function: { arguments: " return" } }])
		xml += processor.processChunk([{ index: 0, function: { arguments: " a" } }])
		xml += processor.processChunk([{ index: 0, function: { arguments: " +" } }])
		xml += processor.processChunk([{ index: 0, function: { arguments: " b" } }])
		xml += processor.processChunk([{ index: 0, function: { arguments: ";\\" } }])
		xml += processor.processChunk([{ index: 0, function: { arguments: "n" } }])
		xml += processor.processChunk([{ index: 0, function: { arguments: "}\\" } }])
		xml += processor.processChunk([{ index: 0, function: { arguments: "n" } }])
		xml += processor.processChunk([{ index: 0, function: { arguments: "\\n" } }])
		xml += processor.processChunk([{ index: 0, function: { arguments: "//" } }])
		xml += processor.processChunk([{ index: 0, function: { arguments: " Example" } }])
		expect(xml).toContain(" Example")
		xml += processor.processChunk([{ index: 0, function: { arguments: " usage" } }])
		xml += processor.processChunk([{ index: 0, function: { arguments: "\\n" } }])
		xml += processor.processChunk([{ index: 0, function: { arguments: "const" } }])
		xml += processor.processChunk([{ index: 0, function: { arguments: " result" } }])
		xml += processor.processChunk([{ index: 0, function: { arguments: " =" } }])
		xml += processor.processChunk([{ index: 0, function: { arguments: " add" } }])
		xml += processor.processChunk([{ index: 0, function: { arguments: "Numbers" } }])
		xml += processor.processChunk([{ index: 0, function: { arguments: "(" } }])
		xml += processor.processChunk([{ index: 0, function: { arguments: "5" } }])
		xml += processor.processChunk([{ index: 0, function: { arguments: "," } }])
		xml += processor.processChunk([{ index: 0, function: { arguments: " " } }])
		xml += processor.processChunk([{ index: 0, function: { arguments: "7" } }])
		xml += processor.processChunk([{ index: 0, function: { arguments: ");" } }])
		xml += processor.processChunk([{ index: 0, function: { arguments: "\\" } }])
		xml += processor.processChunk([{ index: 0, function: { arguments: "n" } }])
		xml += processor.processChunk([{ index: 0, function: { arguments: "console" } }])
		xml += processor.processChunk([{ index: 0, function: { arguments: ".log" } }])
		xml += processor.processChunk([{ index: 0, function: { arguments: "(result" } }])
		xml += processor.processChunk([{ index: 0, function: { arguments: ");" } }])
		xml += processor.processChunk([{ index: 0, function: { arguments: " //" } }])
		xml += processor.processChunk([{ index: 0, function: { arguments: " Output" } }])
		xml += processor.processChunk([{ index: 0, function: { arguments: ":" } }])
		xml += processor.processChunk([{ index: 0, function: { arguments: " " } }])
		xml += processor.processChunk([{ index: 0, function: { arguments: "12" } }])
		expect(xml.endsWith("Output: 12")).toBe(true)
		xml += processor.processChunk([{ index: 0, function: { arguments: '","' } }])
		xml += processor.processChunk([{ index: 0, function: { arguments: "line" } }])
		xml += processor.processChunk([{ index: 0, function: { arguments: "_count" } }])
		xml += processor.processChunk([{ index: 0, function: { arguments: '":' } }])
		xml += processor.processChunk([{ index: 0, function: { arguments: "6" } }])
		xml += processor.processChunk([{ index: 0, function: { arguments: "}" } }])
		expect(xml.trim().endsWith("</write_to_file>")).toBe(true)
	})
})

describe("handleOpenaiToolCallStreaming", () => {
	it("should delegate to processor.processChunk", () => {
		const processor = new StreamingToolCallProcessor()
		const chunk = [{ index: 0, id: "1", function: { name: "read_file", arguments: '{"msg":"hi"}' } }]
		const xml = handleOpenaiToolCallStreaming(processor, chunk, "openai").chunkContent
		expect(xml).toContain("<read_file>")
		expect(xml).toContain("<msg>hi</msg>")
	})

	it("should delegate to apply_diff processor.processChunk", () => {
		const processor = new StreamingToolCallProcessor()
		const chunk = [
			{
				index: 0,
				id: "1",
				function: {
					name: "apply_diff",
					arguments:
						'{"args":{"file":[{"diff":[{"replace":"catch (Exception e) {if (true) {}throw e;}","search":"catch (Exception e) {throw e;}","start_line":252}],"path":"Test.java"},{"replace":"catch (Exception e) {if (true) {}throw e;}","search":"catch (Exception e) {throw e;}","start_line":252}],"path":"Test.java"}]}}',
				},
			},
		]
		const xml = handleOpenaiToolCallStreaming(processor, chunk, "openai").chunkContent
		expect(xml).toContain(`<apply_diff>
<args>
\t<file>
\t\t<diff>
\t\t\t<replace>catch (Exception e) {if (true) {}throw e;}</replace>
\t\t\t<search>catch (Exception e) {throw e;}</search>
\t\t\t<start_line>252</start_line>
\t\t</diff>
\t\t<path>Test.java</path>
\t</file>
\t<file>
\t\t<replace>catch (Exception e) {if (true) {}throw e;}</replace>
\t\t<search>catch (Exception e) {throw e;}</search>
\t\t<start_line>252</start_line>
\t</file>
\t<path>Test.java</path>
</args>
</apply_diff>`)
	})

	it("should delegate to apply_diff2 processor.processChunk ", () => {
		const processor = new StreamingToolCallProcessor()
		const chunk1 = [
			{
				index: 0,
				id: "1",
				function: {
					name: "apply_diff",
					arguments: '{"args":{"file":[{"diff":[{"replace":"catch (Exception e) {if (1==1) {}throw e;}",',
				},
			},
		]
		const chunk2 = [
			{
				index: 0,
				id: "",
				function: {
					name: "",
					arguments: '"search":"catch (Exception e) {throw e;}","start_line":25',
				},
			},
		]
		const chunk3 = [
			{
				index: 0,
				id: "",
				function: {
					name: "",
					arguments: '2}],"path":"Test.java"}]}}',
				},
			},
		]
		let xml = handleOpenaiToolCallStreaming(processor, chunk1, "openai").chunkContent
		expect(xml).not.toContain("<search>")
		expect(xml).not.toContain("true")
		xml += handleOpenaiToolCallStreaming(processor, chunk2, "openai").chunkContent
		expect(xml).toContain("<search>")
		xml += handleOpenaiToolCallStreaming(processor, chunk3, "openai").chunkContent
		expect(xml).toContain("252")
		expect(xml).toContain(`<apply_diff>
<args>
\t<file>
\t\t<diff>
\t\t\t<replace>catch (Exception e) {if (1==1) {}throw e;}</replace>
\t\t\t<search>catch (Exception e) {throw e;}</search>
\t\t\t<start_line>252</start_line>
\t\t</diff>
\t\t<path>Test.java</path>
\t</file>
</args>
</apply_diff>`)
	})

	it("should test read_file multiple file", () => {
		const processor = new StreamingToolCallProcessor()
		const input = `{"args": {"file": [{"path": "pom.xml", "line_range":["1-40","80-120"]}, {"path": "build.gradle"}, {"path": "gradle.properties"}]}}`
		const chunk = [
			{
				index: 0,
				id: "1",
				function: {
					name: "",
					arguments: input,
				},
			},
		]
		let xml = handleOpenaiToolCallStreaming(processor, chunk, "openai").chunkContent
		const chunk2 = [
			{
				index: 0,
				id: "1",
				function: {
					name: "read_file",
					arguments: "",
				},
			},
		]
		xml = handleOpenaiToolCallStreaming(processor, chunk2, "openai").chunkContent
		expect(xml).toContain("<read_file>")
		expect(xml).toContain(`\t<file>
\t\t<path>pom.xml</path>
\t\t<line_range>1-40</line_range>
\t\t<line_range>80-120</line_range>
\t</file>
\t<file>
\t\t<path>build.gradle</path>
\t</file>`)
		expect(xml).toContain("</read_file>")
	})

	it("should handle invalid tool names by rejecting them", () => {
		const processor = new StreamingToolCallProcessor()
		const chunk = [{ index: 0, id: "1", function: { name: "invalid_tool", arguments: '{"msg":"hello"}' } }]
		const xml = handleOpenaiToolCallStreaming(processor, chunk, "openai").chunkContent
		expect(xml).toBe("") // Should produce no output for invalid tools
		expect(handleOpenaiToolCallStreaming(processor, chunk, "openai").toolName).toBe("") // Tool name should be empty
	})
})
