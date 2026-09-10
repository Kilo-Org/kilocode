import { describe, expect, test } from "bun:test"
import type { SessionMessageInfo, ShellInfo } from "@opencode-ai/client"
import { runningShells } from "../src/tui-plugin/sidebar-processes"

const userPart: SessionMessageInfo = {
  id: "msg-user-1",
  time: { created: 1 },
  text: "hello",
  type: "user",
}

function shellPart(
  shellID: string,
  command: string,
  status: "running" | "exited" | "timeout" | "killed",
): SessionMessageInfo {
  return {
    id: `msg-${shellID}`,
    metadata: { background: true },
    time: { created: 1 },
    type: "shell",
    shellID,
    command,
    status,
  }
}

function liveShell(status: ShellInfo["status"], pid?: number): ShellInfo {
  return {
    id: "shell-probe",
    status,
    command: "cmd",
    cwd: "/tmp",
    shell: "/bin/bash",
    file: "/tmp/shell-probe.out",
    ...(pid === undefined ? {} : { pid }),
    metadata: {},
    time: { started: 1 },
  }
}

describe("runningShells", () => {
  test("joins durable shell messages with the live running registry", () => {
    const parts: SessionMessageInfo[] = [userPart, shellPart("shell-1", "sleep 5", "running")]
    const live = (shellID: string) => (shellID === "shell-1" ? liveShell("running", 4242) : undefined)
    expect(runningShells(parts, live)).toEqual([{ command: "sleep 5", pid: 4242 }])
  })

  test("hides durable messages whose live registry entry is not running", () => {
    const parts: SessionMessageInfo[] = [
      shellPart("shell-1", "sleep 5", "exited"),
      shellPart("shell-2", "tail -f log", "running"),
    ]
    const live = (shellID: string) => (shellID === "shell-2" ? liveShell("running", 7) : liveShell("exited", 0))
    expect(runningShells(parts, live)).toEqual([{ command: "tail -f log", pid: 7 }])
  })

  test("a durable running message without a live registry entry never renders", () => {
    const parts: SessionMessageInfo[] = [shellPart("shell-gone", "sleep 5", "running")]
    expect(runningShells(parts, () => undefined)).toEqual([])
  })

  test("renders the command without a PID line when the producer reports none", () => {
    const parts: SessionMessageInfo[] = [shellPart("shell-1", "sleep 5", "running")]
    expect(runningShells(parts, () => liveShell("running"))).toEqual([{ command: "sleep 5", pid: undefined }])
  })
})
