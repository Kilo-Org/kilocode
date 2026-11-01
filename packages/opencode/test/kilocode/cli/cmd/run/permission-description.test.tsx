/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { createSignal } from "solid-js"
import type { PermissionRequest } from "@kilocode/sdk/v2"
import { RunPermissionBody } from "@/cli/cmd/run/footer.permission"
import { RUN_THEME_FALLBACK } from "@/cli/cmd/run/theme"

test("permission context precedes scope and ignores blank or invalid descriptions", async () => {
  const [request, setRequest] = createSignal<PermissionRequest>({
    id: "permission-1",
    sessionID: "session-1",
    permission: "external_directory",
    patterns: ["/external/*"],
    always: ["/external/*"],
    metadata: { description: "Read the report to answer your question" },
  })
  const app = await testRender(
    () => (
      <RunPermissionBody
        request={request()}
        theme={RUN_THEME_FALLBACK.footer}
        block={RUN_THEME_FALLBACK.block}
        onReply={() => {}}
      />
    ),
    { width: 100, height: 20 },
  )
  try {
    for (const permission of ["external_directory", "read", "bash"]) {
      setRequest({ ...request(), permission, metadata: { description: "Task context", command: "bun test" } })
      await app.renderOnce()
      const frame = app.captureCharFrame()
      const scope = permission === "bash" ? "$ bun test" : permission === "read" ? "Path: /external/*" : "- /external/*"
      const lines = frame.split("\n")
      const reason = lines.findIndex((line) => line.includes("Reason: Task context"))
      const target = lines.findIndex((line) => line.includes(scope))
      expect(frame).toContain("Reason: Task context")
      expect(frame).toContain(scope)
      expect(frame.indexOf("Reason: Task context")).toBeLessThan(frame.indexOf(scope))
      expect(target - reason).toBe(2)
      expect(frame).toContain("Allow once")
    }
    setRequest({ ...request(), permission: "external_directory", metadata: {} })
    await app.renderOnce()
    const baseline = app.captureCharFrame()
    setRequest({ ...request(), metadata: { description: " \n\t " } })
    await app.renderOnce()
    expect(app.captureCharFrame()).toBe(baseline)
    setRequest({ ...request(), permission: "doom_loop", metadata: { description: "Task context" } })
    await app.renderOnce()
    expect(app.captureCharFrame()).not.toContain("Task context")
    for (const metadata of [
      { description: "Task context", command: "bun test", skillShell: true },
      { description: "Task context", command: "bun test", backgroundProcess: true },
    ]) {
      setRequest({ ...request(), permission: "bash", metadata })
      await app.renderOnce()
      expect(app.captureCharFrame()).not.toContain("Reason: Task context")
    }
  } finally {
    app.renderer.destroy()
  }
})
