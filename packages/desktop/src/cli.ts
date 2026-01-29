import { invoke } from "@tauri-apps/api/core"
import { message } from "@tauri-apps/plugin-dialog"

export async function installCli(): Promise<void> {
  try {
    const path = await invoke<string>("install_cli")
    // kilocode_change start
    await message(`CLI installed to ${path}\n\nRestart your terminal to use the 'kilo' command.`, {
      title: "CLI Installed",
    })
    // kilocode_change end
  } catch (e) {
    await message(`Failed to install CLI: ${e}`, { title: "Installation Failed" })
  }
}
