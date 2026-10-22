import type { Plugin, PluginInput } from "@kilocode/plugin"
import { ToastNotifier } from "../ui/toast-notifier"
import { createConfigHook } from "./config-hook"
import { createEventHook } from "./event-hook"
import { createChatParamsHook } from "./chat-params-hook"
import { createAuthHook } from "./auth-hook"
import { LOG_PREFIX } from "../constants"

export const AtomicChatPlugin: Plugin = async (input: PluginInput) => {
  const { client } = input

  if (!client || typeof client !== "object") {
    console.error(`${LOG_PREFIX} Invalid client provided to plugin`)
    return {
      config: async () => {},
      event: async () => {},
      "chat.params": async () => {},
    }
  }

  const toastNotifier = new ToastNotifier(client)

  return {
    auth: createAuthHook(),
    config: createConfigHook(client, toastNotifier),
    event: createEventHook(),
    "chat.params": createChatParamsHook(toastNotifier),
  }
}
