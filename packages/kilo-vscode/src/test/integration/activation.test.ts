import * as vscode from "vscode"
import { suite, test } from "mocha"
import assert from "assert"

suite("Extension Activation", function () {
  // Extension activation may take time (CLI startup, etc.)
  this.timeout(60_000)

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

  test("sidebar view is contributed", async () => {
    // Verify the extension contributes the sidebar view by checking
    // registered commands (the focus command is auto-generated for views)
    const commands = await vscode.commands.getCommands(true)
    const focus = commands.find((c) => c.includes("kilo-code.new.sidebarView"))
    assert.ok(focus, "Sidebar view commands not found")
  })
})
