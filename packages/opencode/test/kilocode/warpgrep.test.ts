import { describe, test, expect } from "bun:test"
import { WarpGrep } from "../../src/kilocode/warpgrep"
import { tmpdir } from "../fixture/fixture"
import path from "path"
import fs from "fs/promises"
import { Instance } from "../../src/project/instance"

describe("WarpGrep", () => {
  describe("parseToolCalls", () => {
    test("parses single tool call", () => {
      const xml = `<tool_call><function=ripgrep>{"pattern": "foo", "include": "*.ts"}</function></tool_call>`
      const calls = WarpGrep.parseToolCalls(xml)
      expect(calls).toHaveLength(1)
      expect(calls[0].name).toBe("ripgrep")
      expect(JSON.parse(calls[0].params)).toEqual({ pattern: "foo", include: "*.ts" })
    })

    test("parses multiple tool calls", () => {
      const xml = [
        `<tool_call><function=ripgrep>{"pattern": "foo"}</function></tool_call>`,
        `<tool_call><function=read>{"path": "src/main.ts"}</function></tool_call>`,
      ].join("\n")
      const calls = WarpGrep.parseToolCalls(xml)
      expect(calls).toHaveLength(2)
      expect(calls[0].name).toBe("ripgrep")
      expect(calls[1].name).toBe("read")
    })

    test("parses finish tool call", () => {
      const xml = `<tool_call><function=finish>{"files": "src/main.ts:1-10"}</function></tool_call>`
      const calls = WarpGrep.parseToolCalls(xml)
      expect(calls).toHaveLength(1)
      expect(calls[0].name).toBe("finish")
      expect(JSON.parse(calls[0].params).files).toBe("src/main.ts:1-10")
    })

    test("returns empty array for no tool calls", () => {
      const calls = WarpGrep.parseToolCalls("Just some text without any tool calls")
      expect(calls).toHaveLength(0)
    })

    test("returns empty array for malformed XML", () => {
      const calls = WarpGrep.parseToolCalls("<tool_call><function=broken>unclosed")
      expect(calls).toHaveLength(0)
    })
  })

  describe("readFile", () => {
    test("reads full file when no ranges specified", async () => {
      await using tmp = await tmpdir()
      const filepath = path.join(tmp.path, "test.txt")
      await Bun.write(filepath, "line1\nline2\nline3\nline4\nline5")

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const content = await WarpGrep.readFile(filepath)
          expect(content).toBe("line1\nline2\nline3\nline4\nline5")
        },
      })
    })

    test("reads single range", async () => {
      await using tmp = await tmpdir()
      const filepath = path.join(tmp.path, "test.txt")
      await Bun.write(filepath, "line1\nline2\nline3\nline4\nline5")

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const content = await WarpGrep.readFile(filepath, "2-4")
          expect(content).toBe("line2\nline3\nline4")
        },
      })
    })

    test("reads multiple ranges", async () => {
      await using tmp = await tmpdir()
      const filepath = path.join(tmp.path, "test.txt")
      await Bun.write(filepath, "line1\nline2\nline3\nline4\nline5")

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const content = await WarpGrep.readFile(filepath, "1-2,4-5")
          expect(content).toBe("line1\nline2\n...\nline4\nline5")
        },
      })
    })

    test("returns error for file not found", async () => {
      await using tmp = await tmpdir()

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const content = await WarpGrep.readFile(path.join(tmp.path, "nonexistent.txt"))
          expect(content).toContain("Error: file not found")
        },
      })
    })
  })

  describe("listDirectory", () => {
    test("lists directory contents", async () => {
      await using tmp = await tmpdir({
        init: async (dir) => {
          await Bun.write(path.join(dir, "file1.ts"), "content1")
          await Bun.write(path.join(dir, "file2.ts"), "content2")
          await fs.mkdir(path.join(dir, "subdir"))
        },
      })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const result = await WarpGrep.listDirectory(tmp.path)
          expect(result).toContain("file1.ts")
          expect(result).toContain("file2.ts")
          expect(result).toContain("subdir/")
        },
      })
    })

    test("returns error for nonexistent directory", async () => {
      await using tmp = await tmpdir()

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          await expect(WarpGrep.listDirectory(path.join(tmp.path, "nonexistent"))).rejects.toThrow()
        },
      })
    })
  })

  describe("handleFinish", () => {
    test("reads single file with ranges", async () => {
      await using tmp = await tmpdir()
      const filepath = path.join(tmp.path, "src.ts")
      await Bun.write(filepath, "line1\nline2\nline3\nline4\nline5")

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const result = await WarpGrep.handleFinish(JSON.stringify({ files: `${filepath}:1-3` }))
          expect(result).toContain("--- " + filepath + " ---")
          expect(result).toContain("line1\nline2\nline3")
        },
      })
    })

    test("reads multiple files", async () => {
      await using tmp = await tmpdir()
      const file1 = path.join(tmp.path, "a.ts")
      const file2 = path.join(tmp.path, "b.ts")
      await Bun.write(file1, "alpha\nbeta")
      await Bun.write(file2, "gamma\ndelta")

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const result = await WarpGrep.handleFinish(JSON.stringify({ files: `${file1}:1-2\n${file2}:1-2` }))
          expect(result).toContain("alpha")
          expect(result).toContain("gamma")
        },
      })
    })

    test("reads whole file when no range specified", async () => {
      await using tmp = await tmpdir()
      const filepath = path.join(tmp.path, "whole.ts")
      await Bun.write(filepath, "entire\nfile\ncontent")

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const result = await WarpGrep.handleFinish(JSON.stringify({ files: filepath }))
          expect(result).toContain("entire\nfile\ncontent")
        },
      })
    })
  })
})
