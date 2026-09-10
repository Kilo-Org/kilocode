import { describe, expect, test } from "bun:test"
import iconv from "iconv-lite"
import {
  decodeShellOutput,
  hasEnv,
  ShellOutputDecoder,
  withUtf8StdioEnv,
} from "../../src/kilocode/shell-output-encoding"

const chinese = "你好，世界！步骤5a自动检查通过"

describe("withUtf8StdioEnv", () => {
  test("adds PYTHONIOENCODING=utf-8 when unset", () => {
    const previous = process.env.PYTHONIOENCODING
    delete process.env.PYTHONIOENCODING
    try {
      const next = withUtf8StdioEnv({ PATH: "/usr/bin" })
      expect(next.PYTHONIOENCODING).toBe("utf-8")
      expect(next.PATH).toBe("/usr/bin")
    } finally {
      if (previous === undefined) delete process.env.PYTHONIOENCODING
      else process.env.PYTHONIOENCODING = previous
    }
  })

  test("does not override an existing PYTHONIOENCODING on the overlay", () => {
    const next = withUtf8StdioEnv({ PYTHONIOENCODING: "gbk" })
    expect(next.PYTHONIOENCODING).toBe("gbk")
  })

  test("does not override PYTHONIOENCODING inherited from process.env", () => {
    const previous = process.env.PYTHONIOENCODING
    process.env.PYTHONIOENCODING = "gbk"
    try {
      const next = withUtf8StdioEnv({ PATH: "/usr/bin" })
      expect(next.PYTHONIOENCODING).toBeUndefined()
      expect(next.PATH).toBe("/usr/bin")
    } finally {
      if (previous === undefined) delete process.env.PYTHONIOENCODING
      else process.env.PYTHONIOENCODING = previous
    }
  })

  test("does not set PYTHONUTF8", () => {
    const previous = process.env.PYTHONIOENCODING
    delete process.env.PYTHONIOENCODING
    try {
      const next = withUtf8StdioEnv({})
      expect(next.PYTHONUTF8).toBeUndefined()
    } finally {
      if (previous === undefined) delete process.env.PYTHONIOENCODING
      else process.env.PYTHONIOENCODING = previous
    }
  })
})

describe("hasEnv", () => {
  test("finds an exact key", () => {
    expect(hasEnv({ PYTHONIOENCODING: "utf-8" }, "PYTHONIOENCODING")).toBe(true)
    expect(hasEnv({ PATH: "/bin" }, "PYTHONIOENCODING")).toBe(false)
  })
})

describe("decodeShellOutput", () => {
  test("keeps valid UTF-8 Chinese", () => {
    expect(decodeShellOutput(Buffer.from(chinese, "utf-8"))).toBe(chinese)
  })

  test("decodes GBK Chinese that UTF-8 would replace with U+FFFD", () => {
    const gbk = iconv.encode(chinese, "gbk")
    expect(gbk.equals(Buffer.from(chinese, "utf-8"))).toBe(false)
    expect(() => new TextDecoder("utf-8", { fatal: true }).decode(gbk)).toThrow()
    expect(decodeShellOutput(gbk)).toBe(chinese)
    expect(decodeShellOutput(gbk)).not.toContain("\uFFFD")
  })

  test("decodes a short GBK 你好 that chardet labels as Shift_JIS", () => {
    const hello = Buffer.from([0xc4, 0xe3, 0xba, 0xc3])
    expect(decodeShellOutput(hello)).toBe("你好")
  })

  test("decodes GB18030 Chinese", () => {
    const bytes = iconv.encode(chinese, "gb18030")
    expect(decodeShellOutput(bytes)).toBe(chinese)
  })

  test("keeps ASCII unchanged", () => {
    expect(decodeShellOutput(Buffer.from("PASS A1\nPASS A2\n"))).toBe("PASS A1\nPASS A2\n")
  })

  test("returns empty string for empty bytes", () => {
    expect(decodeShellOutput(Buffer.alloc(0))).toBe("")
  })
})

describe("ShellOutputDecoder", () => {
  test("keeps UTF-8 Chinese when a character is split across pushes", () => {
    const bytes = Buffer.from("你好", "utf-8")
    const decoder = new ShellOutputDecoder()
    const first = decoder.push(bytes.subarray(0, 2))
    const rest = decoder.push(bytes.subarray(2)) + decoder.flush()
    expect(first + rest).toBe("你好")
    expect(first + rest).not.toContain("\uFFFD")
  })

  test("one-shot truncated UTF-8 keeps the valid prefix instead of GB18030", () => {
    const bytes = Buffer.from("步骤5a自动检查通过", "utf-8")
    const truncated = bytes.subarray(0, bytes.length - 1)
    const text = decodeShellOutput(truncated)
    expect(text).toContain("步骤5a")
    expect(text).not.toBe(iconv.decode(truncated, "gb18030"))
  })

  test("streams GBK 你好 across a split lead byte", () => {
    const gbk = Buffer.from([0xc4, 0xe3, 0xba, 0xc3])
    const decoder = new ShellOutputDecoder()
    const first = decoder.push(gbk.subarray(0, 1))
    const rest = decoder.push(gbk.subarray(1)) + decoder.flush()
    expect(first + rest).toBe("你好")
  })

  test("keeps ASCII already emitted when later bytes lock GB18030", () => {
    const decoder = new ShellOutputDecoder()
    const ascii = decoder.push(Buffer.from("PASS A1\n"))
    const next = decoder.push(iconv.encode("你好", "gbk")) + decoder.flush()
    expect(ascii).toBe("PASS A1\n")
    expect(next).toBe("你好")
  })
})
