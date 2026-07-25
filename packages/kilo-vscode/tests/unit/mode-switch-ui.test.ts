import { describe, expect, it } from "bun:test"
import {
  deniedModeSwitch,
  modeSwitchEvent,
  permissionModeSwitch,
} from "../../webview-ui/src/components/chat/mode-switch-ui"
import type { PermissionRequest, QuestionRequest } from "../../webview-ui/src/types/messages"

describe("mode switch UI request detection", () => {
  it("extracts a valid permission transition", () => {
    const request = {
      id: "permission-1",
      sessionID: "session-1",
      toolName: "mode_switch",
      args: { source: "code", target: "debug", reason: "Investigate the failure" },
    } as PermissionRequest

    expect(permissionModeSwitch(request)).toEqual({
      source: "code",
      target: "debug",
      reason: "Investigate the failure",
    })
  })

  it("does not replace the generic permission UI for malformed requests", () => {
    const request = {
      id: "permission-1",
      sessionID: "session-1",
      toolName: "mode_switch",
      args: { source: "code", target: "debug" },
    } as PermissionRequest

    expect(permissionModeSwitch(request)).toBeUndefined()
  })

  it("extracts only the canonical denied mode-switch question", () => {
    const request: QuestionRequest = {
      id: "question-1",
      sessionID: "session-1",
      tool: { messageID: "message-1", callID: "call-1" },
      questions: [
        {
          header: "Mode switch denied",
          question:
            "Switching from code to debug was denied. Reason: Investigate the failing request. Continue in code or cancel this task?",
          options: [
            { label: "Continue current mode", description: "Resume the same task in code.", mode: "code" },
            { label: "Cancel task", description: "Stop without another model step." },
          ],
          custom: false,
        },
      ],
    }

    expect(deniedModeSwitch(request)).toEqual({
      source: "code",
      target: "debug",
      reason: "Investigate the failing request",
    })
    expect(deniedModeSwitch({ ...request, tool: undefined })).toBeUndefined()
  })
})

describe("mode switch transcript event", () => {
  it("describes a successful transition and its reason", () => {
    expect(
      modeSwitchEvent(
        { target: "debug", reason: "Investigate the failure" },
        { status: "switched", source: "code", target: "debug", reason: "Investigate the failure" },
      ),
    ).toEqual({
      title: "Mode switched: code → debug",
      reason: "Investigate the failure",
    })
  })

  it("describes pending and continued outcomes", () => {
    expect(modeSwitchEvent({ target: "debug", reason: "Investigate" }, {})).toEqual({
      title: "Switching to debug…",
      reason: "Investigate",
    })
    expect(modeSwitchEvent({}, { status: "continued", source: "code", reason: "Investigate" })).toEqual({
      title: "Continued in code",
      reason: "Investigate",
    })
  })
})
