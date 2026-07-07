import { describe, expect, test } from "bun:test"
import fs from "fs"
import os from "os"
import path from "path"
import { Systemd } from "../../../src/kilocode/cli/systemd"

describe("Systemd.isAvailable", () => {
  test("returns false on non-linux platforms", () => {
    expect(Systemd.isAvailable("darwin")).toBe(false)
    expect(Systemd.isAvailable("win32")).toBe(false)
  })

  test("returns true on linux when the marker path exists", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "systemd-marker-"))
    try {
      const marker = path.join(dir, "system")
      fs.mkdirSync(marker)
      expect(Systemd.isAvailable("linux", marker)).toBe(true)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  test("returns false on linux when the marker path is missing", () => {
    const marker = path.join(os.tmpdir(), "systemd-marker-missing-xyz", "system")
    expect(Systemd.isAvailable("linux", marker)).toBe(false)
  })
})

describe("Systemd.unitScope", () => {
  test("defaults to user scope", () => {
    expect(Systemd.unitScope({})).toBe("user")
    expect(Systemd.unitScope({ system: false })).toBe("user")
  })

  test("returns system when --system is set", () => {
    expect(Systemd.unitScope({ system: true })).toBe("system")
  })
})

describe("Systemd paths", () => {
  test("userUnitPath honors $XDG_CONFIG_HOME", () => {
    const prev = process.env.XDG_CONFIG_HOME
    process.env.XDG_CONFIG_HOME = "/custom/cfg"
    try {
      expect(Systemd.userUnitPath("kilo-console.service")).toBe(
        path.join("/custom/cfg", "systemd", "user", "kilo-console.service"),
      )
    } finally {
      if (prev === undefined) delete process.env.XDG_CONFIG_HOME
      else process.env.XDG_CONFIG_HOME = prev
    }
  })

  test("userUnitPath falls back to $HOME/.config when XDG_CONFIG_HOME is unset", () => {
    const prevXdg = process.env.XDG_CONFIG_HOME
    const prevHome = process.env.HOME
    delete process.env.XDG_CONFIG_HOME
    process.env.HOME = "/home/test"
    try {
      expect(Systemd.userUnitPath("kilo-console.service")).toBe(
        path.join("/home/test", ".config", "systemd", "user", "kilo-console.service"),
      )
    } finally {
      if (prevXdg === undefined) delete process.env.XDG_CONFIG_HOME
      else process.env.XDG_CONFIG_HOME = prevXdg
      if (prevHome === undefined) delete process.env.HOME
      else process.env.HOME = prevHome
    }
  })

  test("userUnitPath throws when both XDG_CONFIG_HOME and HOME are unset", () => {
    const prevXdg = process.env.XDG_CONFIG_HOME
    const prevHome = process.env.HOME
    delete process.env.XDG_CONFIG_HOME
    delete process.env.HOME
    try {
      expect(() => Systemd.userUnitPath("kilo-console.service")).toThrow(
        /XDG_CONFIG_HOME or HOME/,
      )
    } finally {
      if (prevXdg === undefined) delete process.env.XDG_CONFIG_HOME
      else process.env.XDG_CONFIG_HOME = prevXdg
      if (prevHome === undefined) delete process.env.HOME
      else process.env.HOME = prevHome
    }
  })

  test("systemUnitPath lives under /etc/systemd/system", () => {
    expect(Systemd.systemUnitPath("kilo-console.service")).toBe(
      path.join("/etc/systemd/system", "kilo-console.service"),
    )
  })
})

describe("Systemd.isValidUnitName", () => {
  test("accepts canonical unit names", () => {
    expect(Systemd.isValidUnitName("kilo-console.service")).toBe(true)
    expect(Systemd.isValidUnitName("a.service")).toBe(true)
    expect(Systemd.isValidUnitName("foo-bar_v1.service")).toBe(true)
  })

  test("rejects path traversal, missing extension, or invalid characters", () => {
    expect(Systemd.isValidUnitName("../etc/passwd")).toBe(false)
    expect(Systemd.isValidUnitName("kilo-console")).toBe(false)
    expect(Systemd.isValidUnitName("kilo;rm.service")).toBe(false)
    expect(Systemd.isValidUnitName(".service")).toBe(false)
    expect(Systemd.isValidUnitName("")).toBe(false)
  })
})

describe("Systemd.isValidCorsOrigin", () => {
  test("accepts http(s) URLs", () => {
    expect(Systemd.isValidCorsOrigin("https://a.example")).toBe(true)
    expect(Systemd.isValidCorsOrigin("http://localhost:4097")).toBe(true)
  })

  test("rejects non-http(s) schemes and malformed values", () => {
    expect(Systemd.isValidCorsOrigin("javascript:alert(1)")).toBe(false)
    expect(Systemd.isValidCorsOrigin("file:///etc/passwd")).toBe(false)
    expect(Systemd.isValidCorsOrigin("not a url")).toBe(false)
    expect(Systemd.isValidCorsOrigin("")).toBe(false)
  })
})

describe("Systemd.renderUnit", () => {
  test("produces a deterministic user unit with ExecStart and WantedBy", () => {
    const unit = Systemd.renderUnit({
      description: "Kilo Console daemon",
      execStart: ["/usr/local/bin/kilo", "console", "--foreground"],
    })
    expect(unit).toContain("[Unit]")
    expect(unit).toContain("Description=Kilo Console daemon")
    expect(unit).toContain("[Service]")
    expect(unit).toContain("Type=simple")
    expect(unit).toContain("ExecStart=/usr/local/bin/kilo console --foreground")
    expect(unit).toContain("Restart=on-failure")
    expect(unit).toContain("RestartSec=5")
    expect(unit).toContain("Environment=NODE_ENV=production")
    expect(unit).toContain("[Install]")
    expect(unit).toContain("WantedBy=default.target")
  })

  test("uses multi-user.target for system scope", () => {
    const unit = Systemd.renderUnit({
      description: "Kilo Console daemon",
      execStart: ["/usr/bin/kilo"],
      user: false,
    })
    expect(unit).toContain("WantedBy=multi-user.target")
  })

  test("quotes ExecStart arguments containing whitespace", () => {
    const unit = Systemd.renderUnit({
      description: "test",
      execStart: ["/bin/kilo", "--hostname", "name with space"],
    })
    expect(unit).toContain("ExecStart=/bin/kilo --hostname 'name with space'")
  })
})

describe("Systemd.quoteArg", () => {
  test("leaves simple values untouched", () => {
    expect(Systemd.quoteArg("--port")).toBe("--port")
    expect(Systemd.quoteArg("4097")).toBe("4097")
  })

  test("wraps whitespace in single quotes", () => {
    expect(Systemd.quoteArg("hello world")).toBe("'hello world'")
  })

  test("escapes embedded single quotes", () => {
    expect(Systemd.quoteArg("it's")).toBe("'it'\\''s'")
  })

  test("quotes empty strings", () => {
    expect(Systemd.quoteArg("")).toBe("''")
  })
})

// Minimal reproduction of systemd's extract_first_word() command-line
// tokenizer (src/basic/extract-word.c) with the EXTRACT_CUNESCAPE flag
// that exec_command_append() enables for ExecStart= values. It splits on
// ASCII whitespace and recognizes ', ", and \ as in the systemd grammar.
// Used to round-trip quoteArg() output without requiring systemd on the
// test host.
function parseSystemdArg(input: string): string {
  let out = ""
  enum State {
    None,
    Single,
    Double,
  }
  let state = State.None
  for (let i = 0; i < input.length; ) {
    const c = input[i]
    if (state === State.None) {
      if (c === "'") {
        state = State.Single
        i++
        continue
      }
      if (c === '"') {
        state = State.Double
        i++
        continue
      }
      if (c === "\\") {
        if (i + 1 >= input.length) throw new Error("trailing backslash in systemd arg")
        out += input[i + 1]
        i += 2
        continue
      }
      out += c
      i++
      continue
    }
    if (state === State.Single) {
      if (c === "'") {
        state = State.None
        i++
        continue
      }
      out += c
      i++
      continue
    }
    if (c === '"') {
      state = State.None
      i++
      continue
    }
    if (c === "\\") {
      if (i + 1 >= input.length) throw new Error("trailing backslash in systemd arg")
      out += input[i + 1]
      i += 2
      continue
    }
    out += c
    i++
  }
  return out
}

describe("Systemd.quoteArg round-trip via systemd-compatible parser", () => {
  const cases: string[] = [
    "it's",
    "it's a test",
    "'hello",
    "hello'",
    "it's 'quoted' here",
    "https://example.com/?q=it's",
    "''",
    "foo'bar'baz",
    "a'b'c'd",
    "name with space",
    "name with 'single' and \"double\" quotes",
    "it's got \\ backslashes \\too",
    "https://user:pa$$w0rd@example.com:8443/path?q=it's#frag",
    "unicode: it's 日本語",
    "",
    "plain",
  ]

  for (const value of cases) {
    test(`preserves ${JSON.stringify(value).slice(0, 40)}`, () => {
      const quoted = Systemd.quoteArg(value)
      expect(parseSystemdArg(quoted)).toBe(value)
    })
  }
})
