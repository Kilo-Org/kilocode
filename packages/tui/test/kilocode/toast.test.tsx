/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { ToastProvider, useToast } from "../../src/ui/toast"

test("replacing a toast does not keep the previous title", async () => {
  let toast: ReturnType<typeof useToast>
  function Probe() {
    toast = useToast()
    return <box />
  }

  const app = await testRender(() => (
    <ToastProvider>
      <Probe />
    </ToastProvider>
  ))

  try {
    toast!.show({
      title: "MCP Authentication Required",
      message: `Server "foo" requires authentication.`,
      variant: "warning",
      duration: 0,
    })
    toast!.show({
      variant: "info",
      message: "Updating to v7.4.21...",
      duration: 0,
    })
    expect(toast!.currentToast?.title).toBeUndefined()
    expect(toast!.currentToast?.message).toBe("Updating to v7.4.21...")
    expect(toast!.currentToast?.variant).toBe("info")
  } finally {
    app.renderer.destroy()
  }
})
