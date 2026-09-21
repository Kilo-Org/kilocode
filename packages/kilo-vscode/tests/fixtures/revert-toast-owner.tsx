import assert from "node:assert/strict"
import type { JSX } from "solid-js"
import { harness } from "./comment-harness"

const { mount, wait } = await harness<{ type: string }>()
const { toaster } = await import("@kilocode/kilo-ui/toast")
const { ServerProvider } = await import("../../webview-ui/src/context/server")
const { ProviderProvider } = await import("../../webview-ui/src/context/provider")
const { ConfigProvider } = await import("../../webview-ui/src/context/config")
const { NotificationsProvider } = await import("../../webview-ui/src/context/notifications")
const { SessionProvider } = await import("../../webview-ui/src/context/session")
const { post } = await import("../../webview-ui/src/utils/webview-message")
const { REVERT_ERROR_CODE } = await import("../../src/shared/revert-error")

// Kobalte's dismiss timers keep happy-dom busy, so count the toasts shown instead of rendering a region.
const shown = { value: 0 }
const show = toaster.show
toaster.show = (...args: Parameters<typeof show>) => {
  shown.value += 1
  return show(...args)
}

// The providers build their children inside the tree, so each view stays a function.
const shell = (children: () => JSX.Element) => (
  <ServerProvider>
    <ProviderProvider>
      <ConfigProvider>
        <NotificationsProvider>{children()}</NotificationsProvider>
      </ConfigProvider>
    </ProviderProvider>
  </ServerProvider>
)

const revertFailure = async (where: string, view: () => JSX.Element) => {
  const release = mount(view)
  try {
    await wait()
    shown.value = 0
    post({ type: "error", message: "boom", code: REVERT_ERROR_CODE, sessionID: "s1" })
    await wait()
    assert.equal(shown.value, 1, `Revert failure toasts once ${where}`)
  } finally {
    release()
  }
}

await revertFailure("in a webview with one session provider", () =>
  shell(() => <SessionProvider>{null}</SessionProvider>),
)

// The Agent Manager nests a second provider for the subagent inspector (SubagentPanel), and both
// providers receive this error.
await revertFailure("in a webview with a nested session provider", () =>
  shell(() => (
    <SessionProvider>
      <SessionProvider>{null}</SessionProvider>
    </SessionProvider>
  )),
)
