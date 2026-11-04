import assert from "node:assert/strict"
import { harness } from "./comment-harness"

const { root, messages, mount, wait } = await harness<{ type: string }>()
const { createIntro } = await import("../../webview-ui/agent-manager/intro/AgentManagerIntro")
const { ConfigProvider, useConfig } = await import("../../webview-ui/src/context/config")
const { DialogProvider } = await import("@kilocode/kilo-ui/context/dialog")
const { SessionContext } = await import("../../webview-ui/src/context/session")
const { post } = await import("../../webview-ui/src/utils/webview-message")
const host = window as typeof window & {
  KILO_AGENT_MANAGER_SPLASH?: boolean
  KILO_AGENT_MANAGER_INTRO_DISMISSED?: boolean
  KILO_AGENT_MANAGER_SPLASH_FOLDED?: boolean
}
let intro!: ReturnType<typeof createIntro>
let config!: ReturnType<typeof useConfig>
const View = () => {
  config = useConfig()
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
const render = () =>
  mount(() => (
    <ConfigProvider>
      <DialogProvider>
        <SessionContext.Provider value={{ sessions: () => [] } as never}>
          <View />
        </SessionContext.Provider>
      </DialogProvider>
    </ConfigProvider>
  ))
const setting = (enabled: boolean) =>
  post({
    type: "chatSettingsLoaded",
    settings: { agentManagerSplash: enabled },
  })
const release = render()
try {
  intro.started()
  intro.started()
  await wait()
  assert.ok(root.querySelector(".am-intro"), "default-off uses the legacy intro")
  assert.equal(root.querySelector(".am-splash, .am-splash-folded"), null)
  assert.deepEqual(messages, [], "starting a session while disabled persists nothing")
  config.applySetting("agentManagerSplash", true, "experimental.agentManagerSplash")
  await wait()
  assert.ok(root.querySelector(".am-splash"), "the existing immediate setting API enables the splash")
  assert.equal(config.isDirty(), false, "the opt-in does not enter the save-bar draft")
  intro.started()
  await wait()
  assert.ok(root.querySelector(".am-splash-folded"))
  assert.deepEqual(messages, [{ type: "agentManager.setSplashFolded", folded: true }])
  messages.length = 0
  setting(false)
  await wait()
  assert.ok(root.querySelector(".am-intro"), "a host settings push restores legacy without a reload")
  setting(true)
  await wait()
  assert.ok(root.querySelector(".am-splash-folded"), "the in-memory fold survives disabling and re-enabling")
  assert.deepEqual(messages, [], "toggling does not write either preference")
} finally {
  release()
}

for (const dismissed of [false, true]) {
  for (const folded of [undefined, false, true]) {
    host.KILO_AGENT_MANAGER_SPLASH = true
    host.KILO_AGENT_MANAGER_INTRO_DISMISSED = dismissed
    host.KILO_AGENT_MANAGER_SPLASH_FOLDED = folded
    const release = render()
    try {
      await wait()
      // A saved dismissal hides the splash behind the shared reopen button, ahead of any fold.
      const selector = dismissed ? '[data-action="agent-manager-intro"]' : folded ? ".am-splash-folded" : ".am-splash"
      assert.ok(root.querySelector(selector), "bootstrap restores the opt-in before config loads")
      config.updateSetting("showTokenThroughput", true)
      config.discardConfig()
      await wait()
      assert.ok(root.querySelector(selector), "discarding unrelated drafts retains the bootstrap setting")
      setting(false)
      intro.started()
      await wait()
      assert.equal(root.querySelector(".am-splash, .am-splash-folded"), null)
      assert.equal(Boolean(root.querySelector(".am-intro")), !dismissed, "legacy dismissal is preserved")
      assert.equal(Boolean(root.querySelector('[data-action="agent-manager-intro"]')), dismissed)
      setting(true)
      await wait()
      assert.ok(root.querySelector(selector), "persisted dismissal and fold preferences survive a live round-trip")
      assert.deepEqual(messages, [], "restoring and toggling preferences never overwrites them")
    } finally {
      release()
    }
  }
}
