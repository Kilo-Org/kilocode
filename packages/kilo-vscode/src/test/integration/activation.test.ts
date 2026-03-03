import * as vscode from "vscode"
import { suite, test } from "mocha"
import assert from "assert"

suite("Extension Activation", () => {
  test("extension activates successfully", async () => {
    const ext = vscode.extensions.getExtension("kilocode.kilo-code")
    assert.ok(ext, "Extension not found")
    await ext.activate()
    assert.ok(ext.isActive, "Extension failed to activate")
  })

  test("expected commands are registered", async () => {
    const commands = await vscode.commands.getCommands(true)
    const expected = [
      "kilo-code.new.plusButtonClicked",
      "kilo-code.new.agentManagerOpen",
      "kilo-code.new.settingsButtonClicked",
      "kilo-code.new.openInTab",
    ]
    for (const cmd of expected) {
      assert.ok(commands.includes(cmd), `Command ${cmd} not registered`)
    }
  })

  test("sidebar view provider is registered", async () => {
    // KiloProvider registers as "kilo-code.new.sidebarView"
    // Verify by trying to focus the view
    await vscode.commands.executeCommand("kilo-code.new.sidebarView.focus")
    // If it doesn't throw, the view provider is registered
  })
})
