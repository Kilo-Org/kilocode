import assert from "node:assert/strict"
import { appendFileSync } from "node:fs"
import { commands, extensions, TabInputWebview, window } from "vscode"

// Executed by the installed VS Code extension-test host for the original Kilo extension.
export async function run() {
  const progress = (stage: string) => {
    if (process.env.KILO_TEST_EXTENSION_LOG) appendFileSync(process.env.KILO_TEST_EXTENSION_LOG, `${stage}\n`)
  }
  progress("started")

  // 1. Discover the staged original extension
  const extension = extensions.getExtension("kilocode.kilo-code-v2-preview")
  assert.ok(extension, "Original Kilo preview extension was not discovered")
  progress("extension discovered")

  // 2. Activate the original extension
  await extension.activate()
  progress("activated")
  assert.equal(extension.isActive, true, "Original Kilo extension failed to activate")

  // 3. Verify original contributed command registrations
  const registered = await commands.getCommands(true)
  const requiredCommands = [
    "kilo-code.new.plusButtonClicked",
    "kilo-code.new.openInTab",
    "kilo-code.new.agentManagerOpen",
    "kilo-code.new.kiloClawOpen",
    "kilo-code.new.historyButtonClicked",
    "kilo-code.new.profileButtonClicked",
    "kilo-code.new.settingsButtonClicked",
    "kilo-code.new.focusChatInput",
    "kilo-code.new.toggleAutoApprove",
    "kilo-code.new.generateCommitMessage",
    "kilo-code.new.explainCode",
    "kilo-code.new.fixCode",
    "kilo-code.new.improveCode",
    "kilo-code.new.addToContext",
    "kilo-code.new.terminalAddToContext",
  ]
  for (const cmd of requiredCommands) {
    assert.ok(registered.includes(cmd), `Contributed command ${cmd} is not registered`)
  }
  progress("commands verified")

  // 4. Focus the original Kilo sidebar view (derived from KiloProvider.viewType)
  await commands.executeCommand("kilo-code.SidebarProvider.focus")
  progress("sidebar focused")

  // 5. Open chat in editor tab (openInTab command)
  await commands.executeCommand("kilo-code.new.openInTab")
  progress("openInTab command executed")

  // 6. Wait for the real TabInputWebview to appear in VS Code's tab groups and assert exact panel identity
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      subscription.dispose()
      progress("editor tab did not appear within 10s")
      reject(new Error("Editor webview tab did not appear within 10 seconds"))
    }, 10_000)
    const check = () => {
      const allTabs = window.tabGroups.all.flatMap((group) => group.tabs)
      const tab = allTabs.find(
        (t) =>
          t.input instanceof TabInputWebview &&
          (t.input.viewType.includes("kilo-code.new.TabPanel") || t.label === "Kilo Code"),
      )
      if (tab) {
        clearTimeout(timer)
        subscription.dispose()
        resolve()
      }
    }
    const subscription = window.tabGroups.onDidChangeTabs(check)
    check()
  })
  const allTabsAfterOpen = window.tabGroups.all.flatMap((group) => group.tabs)
  const tab = allTabsAfterOpen.find(
    (t) =>
      t.input instanceof TabInputWebview &&
      (t.input.viewType.includes("kilo-code.new.TabPanel") || t.label === "Kilo Code"),
  )
  assert.ok(tab, "Open in Tab did not create a real TabInputWebview with original panel identity")
  progress("editor tab verified")

  // 7. Open Agent Manager editor panel and assert exact panel identity
  await commands.executeCommand("kilo-code.new.agentManagerOpen")
  progress("agentManagerOpen command executed")

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      subscription.dispose()
      progress("agent manager tab did not appear within 10s")
      reject(new Error("Agent manager webview tab did not appear within 10 seconds"))
    }, 10_000)
    const check = () => {
      const allTabs = window.tabGroups.all.flatMap((group) => group.tabs)
      const amTab = allTabs.find(
        (t) =>
          t.input instanceof TabInputWebview &&
          (t.input.viewType.includes("kilo-code.new.AgentManagerPanel") || t.label === "Agent Manager"),
      )
      if (amTab) {
        clearTimeout(timer)
        subscription.dispose()
        resolve()
      }
    }
    const subscription = window.tabGroups.onDidChangeTabs(check)
    check()
  })
  const allTabsAfterAM = window.tabGroups.all.flatMap((group) => group.tabs)
  const amTab = allTabsAfterAM.find(
    (t) =>
      t.input instanceof TabInputWebview &&
      (t.input.viewType.includes("kilo-code.new.AgentManagerPanel") || t.label === "Agent Manager"),
  )
  assert.ok(amTab, "Agent Manager did not create a real TabInputWebview with original panel identity")
  progress("agent manager verified")

  // 8. Close opened tabs cleanly
  await window.tabGroups.close(window.tabGroups.all.flatMap((group) => group.tabs))
  progress("tabs closed")

  // 9. Final success marker
  progress("KILO_EXISTING_EXTENSION_ACTIVATION_PASS")
  console.log("KILO_EXISTING_EXTENSION_ACTIVATION_PASS")
}
