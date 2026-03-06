import { describe, test, expect } from "bun:test"
import { WarpGrep } from "../../src/kilocode/warpgrep"

describe("WarpGrep", () => {
  describe("parseToolCalls", () => {
    test("parses ripgrep call with XML parameters", () => {
      const xml = `<tool_call>
<function=ripgrep>
<parameter=pattern>authenticate</parameter>
<parameter=path>src/</parameter>
</function>
</tool_call>`
      const calls = WarpGrep.parseToolCalls(xml)
      expect(calls).toHaveLength(1)
      expect(calls[0].name).toBe("grep")
      expect(calls[0].arguments).toEqual({ pattern: "authenticate", path: "src/" })
    })

    test("parses ripgrep with optional params", () => {
      const xml = `<tool_call>
<function=ripgrep>
<parameter=pattern>foo|bar</parameter>
<parameter=path>src/</parameter>
<parameter=glob>*.ts</parameter>
<parameter=context_lines>3</parameter>
</function>
</tool_call>`
      const calls = WarpGrep.parseToolCalls(xml)
      expect(calls).toHaveLength(1)
      expect(calls[0].arguments).toEqual({
        pattern: "foo|bar",
        path: "src/",
        glob: "*.ts",
        context_lines: 3,
      })
    })

    test("parses multiple tool calls", () => {
      const xml = `<tool_call>
<function=ripgrep>
<parameter=pattern>authenticate</parameter>
<parameter=path>src/</parameter>
</function>
</tool_call>

<tool_call>
<function=read>
<parameter=path>src/auth/login.ts</parameter>
<parameter=lines>1-50</parameter>
</function>
</tool_call>

<tool_call>
<function=list_directory>
<parameter=path>src/auth</parameter>
</function>
</tool_call>`
      const calls = WarpGrep.parseToolCalls(xml)
      expect(calls).toHaveLength(3)
      expect(calls[0].name).toBe("grep")
      expect(calls[1].name).toBe("read")
      expect(calls[1].arguments).toEqual({ path: "src/auth/login.ts", start: 1, end: 50 })
      expect(calls[2].name).toBe("list_directory")
      expect(calls[2].arguments).toEqual({ path: "src/auth" })
    })

    test("parses finish with file ranges", () => {
      const xml = `<tool_call>
<function=finish>
<parameter=files>src/auth/login.ts:1-50,80-120
src/middleware/auth.ts:*</parameter>
</function>
</tool_call>`
      const calls = WarpGrep.parseToolCalls(xml)
      expect(calls).toHaveLength(1)
      expect(calls[0].name).toBe("finish")
      const args = calls[0].arguments as { files: Array<{ path: string; lines: unknown }> }
      expect(args.files).toHaveLength(2)
      expect(args.files[0].path).toBe("src/auth/login.ts")
      expect(args.files[0].lines).toEqual([[1, 50], [80, 120]])
      expect(args.files[1].path).toBe("src/middleware/auth.ts")
      expect(args.files[1].lines).toBe("*")
    })

    test("parses finish with text result fallback", () => {
      const xml = `<tool_call>
<function=finish>
<parameter=result>No relevant authentication code found in this repository.</parameter>
</function>
</tool_call>`
      const calls = WarpGrep.parseToolCalls(xml)
      expect(calls).toHaveLength(1)
      expect(calls[0].name).toBe("finish")
      expect((calls[0].arguments as { textResult: string }).textResult).toContain("No relevant authentication")
    })

    test("parses read with multiple line ranges", () => {
      const xml = `<tool_call>
<function=read>
<parameter=path>src/main.ts</parameter>
<parameter=lines>1-20,45-80</parameter>
</function>
</tool_call>`
      const calls = WarpGrep.parseToolCalls(xml)
      expect(calls).toHaveLength(1)
      expect(calls[0].arguments).toEqual({
        path: "src/main.ts",
        lines: [[1, 20], [45, 80]],
      })
    })

    test("strips think blocks before parsing", () => {
      const xml = `<think>
Looking for auth middleware. Let me search for relevant patterns.
</think>

<tool_call>
<function=ripgrep>
<parameter=pattern>middleware</parameter>
</function>
</tool_call>`
      const calls = WarpGrep.parseToolCalls(xml)
      expect(calls).toHaveLength(1)
      expect(calls[0].name).toBe("grep")
    })

    test("returns empty array for no tool calls", () => {
      expect(WarpGrep.parseToolCalls("Just some text")).toHaveLength(0)
    })

    test("returns empty array for malformed XML", () => {
      expect(WarpGrep.parseToolCalls("<tool_call><function=broken>unclosed")).toHaveLength(0)
    })

    test("skips ripgrep without pattern", () => {
      const xml = `<tool_call>
<function=ripgrep>
<parameter=path>src/</parameter>
</function>
</tool_call>`
      expect(WarpGrep.parseToolCalls(xml)).toHaveLength(0)
    })

    test("skips read without path", () => {
      const xml = `<tool_call>
<function=read>
<parameter=lines>1-50</parameter>
</function>
</tool_call>`
      expect(WarpGrep.parseToolCalls(xml)).toHaveLength(0)
    })

    test("defaults ripgrep path to .", () => {
      const xml = `<tool_call>
<function=ripgrep>
<parameter=pattern>foo</parameter>
</function>
</tool_call>`
      const calls = WarpGrep.parseToolCalls(xml)
      expect(calls[0].arguments.path).toBe(".")
    })

    test("defaults list_directory path to .", () => {
      const xml = `<tool_call>
<function=list_directory>
</function>
</tool_call>`
      const calls = WarpGrep.parseToolCalls(xml)
      expect(calls).toHaveLength(1)
      expect(calls[0].arguments.path).toBe(".")
    })

    test("parses finish with whole file (no colon)", () => {
      const xml = `<tool_call>
<function=finish>
<parameter=files>src/main.ts</parameter>
</function>
</tool_call>`
      const calls = WarpGrep.parseToolCalls(xml)
      const args = calls[0].arguments as { files: Array<{ path: string; lines: unknown }> }
      expect(args.files[0]).toEqual({ path: "src/main.ts", lines: "*" })
    })
  })
})
