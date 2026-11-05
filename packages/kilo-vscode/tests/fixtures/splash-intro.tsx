import assert from "node:assert/strict"
import { harness } from "./comment-harness"

const { root, messages, mount, wait } = await harness<{ type: string }>()
const { createIntro } = await import("../../webview-ui/agent-manager/intro/AgentManagerIntro")
const { ConfigProvider } = await import("../../webview-ui/src/context/config")
const { DialogProvider } = await import("@kilocode/kilo-ui/context/dialog")
const { SessionContext } = await import("../../webview-ui/src/context/session")
const { post } = await import("../../webview-ui/src/utils/webview-message")
let intro!: ReturnType<typeof createIntro>
const View = () => {
  intro = createIntro({
    base: () => "main",
    git: () => true,
    onCreateWorktree: () => {},
    reveal: () => {},
    focus: () => {},
    compose: () => {},
  })
  return intro.render()
}
const release = mount(() => (
  <ConfigProvider>
    <DialogProvider>
      <SessionContext.Provider value={{ sessions: () => [] } as never}>
        <View />
      </SessionContext.Provider>
    </DialogProvider>
  </ConfigProvider>
))
try {
  intro.started()
  await wait()
  assert.ok(root.querySelector(".am-intro"), "default-off uses the legacy intro")
  assert.equal(root.querySelector(".am-splash, .am-splash-folded"), null)
  assert.deepEqual(messages, [], "starting a session while disabled persists nothing")
  post({ type: "chatSettingsLoaded", settings: { agentManagerSplash: true } })
  await wait()
  assert.ok(root.querySelector(".am-splash"), "the host setting enables the splash without a reload")
  post({ type: "chatSettingsLoaded", settings: { agentManagerSplash: false } })
  await wait()
  assert.ok(root.querySelector(".am-intro"), "disabling restores the legacy intro without a reload")
} finally {
  release()
}
