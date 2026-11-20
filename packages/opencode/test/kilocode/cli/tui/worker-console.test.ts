import { describe, expect, test } from "bun:test"
import { WorkerConsole } from "../../../../src/kilocode/cli/cmd/tui/worker-console"

/** A console whose writers land on a captured stream, standing in for the TUI's terminal. */
function terminal() {
  const written: string[] = []
  const write = (...args: any[]) => {
    written.push(args.join(" "))
  }
  return {
    written,
    console: {
      log: write,
      info: write,
      debug: write,
      trace: write,
      warn: write,
      error: write,
      dir: write,
      table: write,
    },
  }
}

function writer() {
  const lines: string[] = []
  return {
    lines,
    log: {
      debug: (message?: any) => lines.push("DEBUG " + message),
      info: (message?: any) => lines.push("INFO " + message),
      warn: (message?: any) => lines.push("WARN " + message),
      error: (message?: any) => lines.push("ERROR " + message),
    },
  }
}

describe("TUI worker console redirect", () => {
  test("keeps console writes off the terminal and files them under their level", () => {
    const out = terminal()
    const sink = writer()
    const restore = WorkerConsole.redirect(out.console, sink.log)

    out.console.log("plain")
    out.console.info("info")
    out.console.debug("debug")
    out.console.warn("[mcp-sdk] stored OAuth tokens have no 'issuer' property")
    out.console.error("boom")
    restore()

    expect(out.written).toEqual([])
    expect(sink.lines).toEqual([
      "INFO plain",
      "INFO info",
      "DEBUG debug",
      "WARN [mcp-sdk] stored OAuth tokens have no 'issuer' property",
      "ERROR boom",
    ])
  })

  test("formats multiple arguments, errors and objects into one line", () => {
    const out = terminal()
    const sink = writer()
    const restore = WorkerConsole.redirect(out.console, sink.log)

    out.console.warn("refresh failed", new Error("no issuer"), { server: "monday" })
    restore()

    expect(out.written).toEqual([])
    expect(sink.lines).toHaveLength(1)
    expect(sink.lines.at(0)).toStartWith("WARN refresh failed Error: no issuer")
    expect(sink.lines.at(0)).toContain('server: "monday"')
  })

  test("collapses an inspected value onto a single log line", () => {
    const out = terminal()
    const sink = writer()
    const restore = WorkerConsole.redirect(out.console, sink.log)

    out.console.info("config", { mcp: { monday: { enabled: true, url: "https://mcp.monday.com" } } })
    restore()

    expect(sink.lines).toHaveLength(1)
    expect(sink.lines.at(0)).not.toContain("\n")
    expect(sink.lines.at(0)).toContain("enabled: true")
  })

  test("restores the original writers so the console works after shutdown", () => {
    const out = terminal()
    const sink = writer()
    const restore = WorkerConsole.redirect(out.console, sink.log)
    restore()

    out.console.error("back on the terminal")

    expect(sink.lines).toEqual([])
    expect(out.written).toEqual(["back on the terminal"])
  })

  test("a second redirect leaves the first restore in charge of the originals", () => {
    const out = terminal()
    const first = writer()
    const second = writer()
    const restore = WorkerConsole.redirect(out.console, first.log)
    const noop = WorkerConsole.redirect(out.console, second.log)

    noop()
    out.console.warn("still captured")
    expect(out.written).toEqual([])
    expect(first.lines).toEqual(["WARN still captured"])
    expect(second.lines).toEqual([])

    restore()
    out.console.warn("released")
    expect(out.written).toEqual(["released"])
  })
})
