import { describe, expect, it } from "bun:test"
import path from "node:path"
import {
  MODE_SWITCH_TRANSITION_ICON,
  modeSwitchEvent,
  permissionModeSwitch,
} from "../../webview-ui/src/components/chat/mode-switch-ui"
import type { PermissionRequest } from "../../webview-ui/src/types/messages"

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
})

describe("mode switch transcript event", () => {
  it("uses a transition glyph for static mode-switch surfaces", () => {
    expect(MODE_SWITCH_TRANSITION_ICON).toBe("arrow-right")
  })

  it("reserves the selector glyph for the interactive prompt picker", async () => {
    const root = path.resolve(import.meta.dir, "../../webview-ui/src/components")
    const staticSources = await Promise.all(
      ["chat/ModeSwitchCard.tsx", "chat/TaskToolExpanded.tsx", "chat/VscodeToolOverrides.tsx"].map((file) =>
        Bun.file(path.join(root, file)).text(),
      ),
    )
    const picker = await Bun.file(path.join(root, "shared/ModeSwitcher.tsx")).text()

    expect(staticSources.join("\n")).not.toContain('name="selector"')
    expect(picker).toContain('<Icon name="selector"')
  })

  it("keeps static transition reasons in a dedicated wrapping row", async () => {
    const root = path.resolve(import.meta.dir, "../../webview-ui/src")
    const renderers = await Promise.all(
      ["components/chat/TaskToolExpanded.tsx", "components/chat/VscodeToolOverrides.tsx"].map((file) =>
        Bun.file(path.join(root, file)).text(),
      ),
    )
    const styles = await Bun.file(path.join(root, "styles/mode-switch-card.css")).text()

    for (const renderer of renderers) {
      expect(renderer).toContain('data-slot="mode-switch-event-title"')
      expect(renderer).toContain('data-slot="mode-switch-event-reason"')
    }
    expect(styles).toContain("white-space: normal")
    expect(styles).toContain("overflow-wrap: anywhere")
  })

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

  it("describes pending and cancelled outcomes", () => {
    expect(modeSwitchEvent({ target: "debug", reason: "Investigate" }, {})).toEqual({
      title: "Switching to debug…",
      reason: "Investigate",
    })
    expect(modeSwitchEvent({}, { status: "continued", source: "code", reason: "Investigate" })).toEqual({
      title: "Mode switch cancelled · Task continues in code",
    })
    expect(modeSwitchEvent({}, { status: "stopped", source: "code", reason: "Investigate" })).toEqual({
      title: "Mode switch cancelled · Task stopped",
    })
  })
})
