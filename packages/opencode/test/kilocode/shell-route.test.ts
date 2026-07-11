import { describe, expect, test } from "bun:test"
import type { Permission } from "../../src/permission"
import { Instance } from "../../src/project/instance"
import { SessionID, MessageID } from "../../src/session/schema"
import { BashTool } from "../../src/tool/bash"
import { which } from "../../src/util/which"
import { tmpdir } from "../fixture/fixture"
import { type ShellRoute, peel, resolve } from "../../src/kilocode/shell-route"

const ctx = {
  sessionID: SessionID.make("ses_test"),
  messageID: MessageID.make(""),
  callID: "",
  agent: "code" as const,
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => {},
  ask: async () => {},
}

describe("shell route", () => {
  test("peel strips ps prefix", () => {
    expect(peel("ps: Write-Output hi")).toEqual({ route: "ps", command: "Write-Output hi" })
  })

  test("peel leaves plain commands unchanged", () => {
    expect(peel("git status -sb")).toEqual({ command: "git status -sb" })
  })

  test("resolve cmd uses slash c", () => {
    const route: ShellRoute = "cmd"
    const next = resolve(route)
    expect(next.args).toEqual(["/d", "/s", "/c"])
    expect(next.args).not.toContain("-c")
  })

  test("resolve ps uses powershell command args", () => {
    expect(resolve("ps").args).toEqual(["-NoProfile", "-Command"])
  })

  test("resolve bash uses login command args", () => {
    expect(resolve("bash").args).toEqual(["-lc"])
  })

  test("resolve bash ignores shell env", () => {
    const prev = process.env.SHELL
    process.env.SHELL = "C:/fake/not-bash-shell"
    const next = resolve("bash")
    if (prev === undefined) delete process.env.SHELL
    else process.env.SHELL = prev
    expect(next.bin).not.toBe("C:/fake/not-bash-shell")
  })
})

describe("shell route permissions", () => {
  test("explicit cmd route asks with peeled command", async () => {
    if (process.platform !== "win32") return
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const requests: Array<Omit<Permission.Request, "id" | "sessionID" | "tool">> = []
        const testCtx = {
          ...ctx,
          ask: async (req: Omit<Permission.Request, "id" | "sessionID" | "tool">) => {
            requests.push(req)
          },
        }
        const result = await bash.execute(
          {
            command: "cmd: echo hello",
            description: "Echo hello through cmd",
          },
          testCtx,
        )
        const bashReq = requests.find((item) => item.permission === "bash")
        expect(bashReq).toBeDefined()
        expect(bashReq!.patterns).toEqual(["echo hello"])
        expect(bashReq!.always).toEqual([])
        expect(bashReq!.metadata.command).toBe("echo hello")
        expect(bashReq!.metadata.rules).toEqual([])
        expect(result.metadata.exit).toBe(0)
        expect(result.output.toLowerCase()).toContain("hello")
      },
    })
  })

  test("explicit ps route asks with peeled command", async () => {
    if (!which("pwsh")) return
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const requests: Array<Omit<Permission.Request, "id" | "sessionID" | "tool">> = []
        const testCtx = {
          ...ctx,
          ask: async (req: Omit<Permission.Request, "id" | "sessionID" | "tool">) => {
            requests.push(req)
          },
        }
        const result = await bash.execute(
          {
            command: "ps: Write-Output hello",
            description: "Echo hello through powershell",
          },
          testCtx,
        )
        const bashReq = requests.find((item) => item.permission === "bash")
        expect(bashReq).toBeDefined()
        expect(bashReq!.patterns).toEqual(["Write-Output hello"])
        expect(bashReq!.always).toEqual([])
        expect(bashReq!.metadata.command).toBe("Write-Output hello")
        expect(bashReq!.metadata.rules).toEqual([])
        expect(result.metadata.exit).toBe(0)
        expect(result.output).toContain("hello")
      },
    })
  })
})
