import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { tmpdir } from "../../fixture/fixture"
import { resolveThreadDirectory } from "../../../src/cli/cmd/tui/thread"
// kilocode_change start - extra bun:test helpers + module spies for auto-approve plumbing test
import { afterEach, mock, spyOn } from "bun:test"
import * as App from "../../../src/cli/cmd/tui/app"
import { Rpc } from "@/util/rpc"
import { UI } from "../../../src/cli/ui"
import * as Timeout from "../../../src/util/timeout"
import * as Network from "../../../src/cli/network"
import * as Win32 from "../../../src/cli/cmd/tui/win32"

const stop = new Error("stop")
const seen = {
  args: [] as Array<{ autoApprove?: boolean }>,
}

function setupTuiSpies() {
  // Intentionally avoid mock.module() here: Bun keeps module overrides in cache
  // and mock.restore() does not reset mock.module values. If this switches back
  // to module mocks, later suites can see mocked @/config/tui and fail.
  // See: https://github.com/oven-sh/bun/issues/7823 and #12823.
  spyOn(App, "tui").mockImplementation((input) => {
    seen.args.push({ autoApprove: input.args.autoApprove })
    throw stop
  })
  spyOn(Rpc, "client").mockImplementation(() => ({
    call: async () => ({ url: "http://127.0.0.1" }) as never,
    on: () => () => {},
  }))
  spyOn(UI, "error").mockImplementation(() => {})
  spyOn(Timeout, "withTimeout").mockImplementation((input) => input)
  // resolveNetworkOptions is now an Effect.fn — mock the no-config variant instead
  spyOn(Network, "resolveNetworkOptionsNoConfig").mockReturnValue({
    mdns: false,
    port: 0,
    hostname: "127.0.0.1",
    mdnsDomain: "opencode.local",
    cors: [] as string[],
  } as any)
  spyOn(Win32, "win32DisableProcessedInput").mockImplementation(() => {})
  spyOn(Win32, "win32InstallCtrlCGuard").mockReturnValue(undefined)
}
// kilocode_change end

describe("tui thread", () => {
  async function check(project?: string) {
    await using tmp = await tmpdir({ git: true })
    const link = path.join(path.dirname(tmp.path), path.basename(tmp.path) + "-link")
    const type = process.platform === "win32" ? "junction" : "dir"

    try {
      await fs.symlink(tmp.path, link, type)
      expect(resolveThreadDirectory(project, link, tmp.path)).toBe(tmp.path)
    } finally {
      await fs.rm(link, { recursive: true, force: true }).catch(() => undefined)
    }
  }

  test("uses the real cwd when PWD points at a symlink", async () => {
    await check()
  })

  test("uses the real cwd after resolving a relative project from PWD", async () => {
    await check(".")
  })

  // kilocode_change start - assert --auto-approve is plumbed into TUI args
  describe("auto-approve plumbing", () => {
    afterEach(() => {
      mock.restore()
    })

    test("forwards auto-approve flag into tui args", async () => {
      setupTuiSpies()
      await using tmp = await tmpdir({ git: true })
      const cwd = process.cwd()
      const worker = globalThis.Worker
      const tty = Object.getOwnPropertyDescriptor(process.stdin, "isTTY")
      seen.args.length = 0

      Object.defineProperty(process.stdin, "isTTY", {
        configurable: true,
        value: true,
      })
      globalThis.Worker = class extends EventTarget {
        onerror = null
        onmessage = null
        onmessageerror = null
        postMessage() {}
        terminate() {}
      } as unknown as typeof Worker

      try {
        process.chdir(tmp.path)
        const { TuiThreadCommand } = await import("../../../src/cli/cmd/tui/thread")
        const args: Parameters<NonNullable<typeof TuiThreadCommand.handler>>[0] = {
          _: [],
          $0: "kilo",
          project: undefined,
          prompt: "hi",
          model: undefined,
          agent: undefined,
          session: undefined,
          continue: false,
          fork: false,
          "auto-approve": true,
          autoApprove: true,
          "cloud-fork": undefined,
          cloudFork: undefined,
          port: 0,
          hostname: "127.0.0.1",
          mdns: false,
          "mdns-domain": "kilo.local",
          mdnsDomain: "kilo.local",
          cors: [],
        }
        await expect(TuiThreadCommand.handler(args)).rejects.toBe(stop)
        expect(seen.args[0]).toEqual({ autoApprove: true })
      } finally {
        process.chdir(cwd)
        if (tty) Object.defineProperty(process.stdin, "isTTY", tty)
        else delete (process.stdin as { isTTY?: boolean }).isTTY
        globalThis.Worker = worker
      }
    })
  })
  // kilocode_change end
})
