import { invoke } from "@tauri-apps/api/core"
import { message } from "@tauri-apps/plugin-dialog"

import { initI18n, t } from "./i18n"

export async function installCli(): Promise<void> {
  await initI18n()

  try {
    const path = await invoke<string>("install_cli")
    // kilocode_change start - Use 'kilo' branding
    await message(`CLI installed to ${path}\n\nRestart your terminal to use the 'kilo' command.`, {
      title: "CLI Installed",
    })
    // kilocode_change end
  } catch (e) {
    await message(t("desktop.cli.failed.message", { error: String(e) }), { title: t("desktop.cli.failed.title") })
  }
}
