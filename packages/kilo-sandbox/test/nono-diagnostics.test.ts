import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"
import { classify, redact } from "../src/nono-diagnostics"

function fixture(name: string) {
  return readFileSync(path.join(import.meta.dir, "fixtures", "nono", name), "utf8")
}

describe("nono diagnostics", () => {
  test("reads a path denial from the JSON session", () => {
    const result = classify({ code: 1, stderr: fixture("diagnostics-denied-read.txt") })
    expect(result).toMatchObject({
      kind: "denied-path",
      exit: 1,
      codes: ["sandbox_denied_path", "command_failed_likely_sandbox", "command_failed_application"],
      paths: ["/tmp/kilo-fixture/work/denied.txt"],
    })
  })

  test("reads a network denial from the violations", () => {
    const result = classify({ code: 7, stderr: fixture("diagnostics-network.txt") })
    expect(result).toMatchObject({ kind: "denied-network", exit: 7 })
  })

  test("treats the generic advice codes on a successful run as no diagnostics", () => {
    expect(classify({ code: 0, stderr: fixture("diagnostics-exit-zero.txt") })).toBeUndefined()
  })

  test("classifies the human footer when the JSON is absent", () => {
    expect(classify({ code: 1, stderr: fixture("footer-denied-read.txt") })).toMatchObject({
      kind: "denied-path",
      exit: 1,
    })
  })

  test("classifies the silent denial errno", () => {
    expect(classify({ code: 1, stderr: "cat: /tmp/x: Operation not permitted" })).toMatchObject({
      kind: "denied-path",
    })
    expect(classify({ code: 7, stderr: "Couldn't connect to server" })).toMatchObject({ kind: "denied-network" })
  })

  test("classifies a command nono could not start", () => {
    expect(classify({ code: 1, stderr: fixture("missing-command.txt") })).toMatchObject({ kind: "not-found" })
  })

  test("does not treat the generic advice codes as a denial", () => {
    const stderr = JSON.stringify({
      session: {
        exit_code: 1,
        denials: [],
        diagnostics: [{ code: "command_failed_likely_sandbox" }, { code: "command_failed_application" }],
      },
    })
    expect(classify({ code: 1, stderr })).toMatchObject({ kind: "unknown", exit: 1 })
  })

  test("uses the caller's exit when the session omits it", () => {
    expect(classify({ code: 3, stderr: JSON.stringify({ session: { diagnostics: [] } }) })).toMatchObject({
      kind: "unknown",
      exit: 3,
    })
  })

  test("prefers a socket denial over a named path", () => {
    const stderr = JSON.stringify({
      session: {
        exit_code: 1,
        denials: [{ path: "/tmp/socket" }],
        diagnostics: [{ code: "sandbox_denied_unix_socket", path: "/tmp/socket" }],
      },
    })
    expect(classify({ code: 1, stderr })).toMatchObject({ kind: "denied-socket", paths: ["/tmp/socket"] })
  })

  test("finds the session block after another object", () => {
    const stderr = JSON.stringify({
      proxy: { ok: true },
      session: { exit_code: 1, denials: [{ path: "/tmp/x" }] },
    })
    expect(classify({ code: 1, stderr })).toMatchObject({ kind: "denied-path", paths: ["/tmp/x"] })
  })

  test("labels empty failed output as unknown", () => {
    expect(classify({ code: 9, stderr: "" })).toMatchObject({ kind: "unknown", exit: 9 })
  })

  test("falls back to the command's own exit and success", () => {
    expect(classify({ code: 7, stderr: "boom" })).toMatchObject({ kind: "application", exit: 7 })
    expect(classify({ code: 0, stderr: "hello" })).toBeUndefined()
  })

  test("reads a path denial when only a data-access violation is recorded", () => {
    const stderr = JSON.stringify({
      session: {
        exit_code: 1,
        denials: [],
        violations: [{ operation: "file-read-data", target: "/tmp/kilo-fixture/secret" }],
        diagnostics: [{ code: "command_failed_likely_sandbox" }],
      },
    })
    expect(classify({ code: 1, stderr })).toMatchObject({ kind: "denied-path", exit: 1 })
  })

  test("upgrades an incomplete session from the raw errno", () => {
    const stderr = `cat: /tmp/x: Operation not permitted\n${JSON.stringify({
      session: { exit_code: 1, denials: [], violations: [], diagnostics: [] },
    })}`
    expect(classify({ code: 1, stderr })).toMatchObject({ kind: "denied-path", exit: 1 })
  })

  test("ignores an incidental metadata violation", () => {
    const stderr = JSON.stringify({
      session: {
        exit_code: 1,
        denials: [],
        violations: [{ operation: "file-read-metadata", target: "/tmp/x" }],
      },
    })
    expect(classify({ code: 1, stderr })).toMatchObject({ kind: "unknown" })
  })

  test("keeps a successful run successful even when stderr looks like a denial", () => {
    expect(classify({ code: 0, stderr: "x: Permission denied" })).toBeUndefined()
    const stderr = `x: Permission denied\n${JSON.stringify({ session: { exit_code: 0, diagnostics: [] } })}`
    expect(classify({ code: 0, stderr })).toBeUndefined()
  })

  test("never carries a caller secret into the result", () => {
    const stderr = ["cat: /tmp/x: Operation not permitted token-123", fixture("diagnostics-denied-read.txt")].join("\n")
    const result = classify({ code: 1, stderr, secrets: ["token-123"] })
    expect(result?.text).not.toContain("token-123")
    expect(result?.text).toContain("[redacted]")
    expect(redact("a secret b", ["secret"])).toBe("a [redacted] b")
  })
})
