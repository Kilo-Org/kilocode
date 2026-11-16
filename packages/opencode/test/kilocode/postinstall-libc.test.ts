import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test"
import { isLibcCompatible, main } from "../../script/postinstall.mjs"

const arm = "@kilocode/cli-linux-arm64"
const musl = `${arm}-musl`

describe("isLibcCompatible", () => {
  it("skips only confirmed mismatches", () => {
    expect(isLibcCompatible(arm, "glibc")).toBe(true)
    expect(isLibcCompatible(musl, "glibc")).toBe(false)
    expect(isLibcCompatible("@kilocode/cli-linux-x64-baseline-musl", "glibc")).toBe(false)
    expect(isLibcCompatible(arm, "musl")).toBe(false)
    expect(isLibcCompatible(musl, "musl")).toBe(true)
  })

  it("never blocks when libc is unknown", () => {
    expect(isLibcCompatible(arm, "unknown")).toBe(true)
    expect(isLibcCompatible(musl, "unknown")).toBe(true)
  })

  it("ignores non-linux packages", () => {
    expect(isLibcCompatible("@kilocode/cli-darwin-arm64", "musl")).toBe(true)
    expect(isLibcCompatible("@kilocode/cli-windows-x64", "glibc")).toBe(true)
  })
})

describe("postinstall installer loop", () => {
  const logs: string[] = []

  beforeEach(() => {
    logs.length = 0
    spyOn(console, "error").mockImplementation((msg: string) => void logs.push(String(msg)))
    spyOn(console, "log").mockImplementation((msg: string) => void logs.push(String(msg)))
  })

  afterEach(() => mock.restore())

  const run = (input: { libc: string; names: string[]; installed: string[]; status: number | null; signal?: string }) => {
    const calls: string[] = []
    const fn = () =>
      main({
        platform: "linux",
        libc: input.libc,
        names: input.names,
        resolve: (name: string) => {
          calls.push(`resolve:${name}`)
          if (input.installed.includes(name)) return "/fake/kilo"
          throw new Error("missing")
        },
        copy: () => undefined,
        spawn: (cmd: string) => {
          calls.push(`spawn:${cmd}`)
          return { status: input.status, signal: input.signal ?? null, stdout: "", stderr: "" }
        },
      })
    return { fn, calls }
  }

  it("does not npm-install the musl package on a confirmed glibc host", () => {
    const { fn, calls } = run({ libc: "glibc", names: [arm, musl], installed: [arm], status: 1 })
    expect(fn).toThrow("package manager failed")
    expect(calls).not.toContain("spawn:npm")
    expect(logs.some((l) => l.includes(`skipping ${musl}`))).toBe(true)
  })

  it("keeps an already-installed working musl binary when libc is unknown", () => {
    const { fn, calls } = run({ libc: "unknown", names: [musl], installed: [musl], status: 0 })
    expect(fn).not.toThrow()
    expect(calls[0]).toBe(`resolve:${musl}`)
    expect(logs.some((l) => l.includes("skipping"))).toBe(false)
  })

  it("logs exit status and signal for signal-only failures", () => {
    const { fn } = run({ libc: "glibc", names: [arm], installed: [arm], status: null, signal: "SIGILL" })
    expect(fn).toThrow()
    expect(logs.some((l) => l.includes("status=null signal=SIGILL"))).toBe(true)
  })
})