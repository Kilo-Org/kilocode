import type { Provider } from "@opencode-ai/core/models-dev"

const KEY = "GMI_API_KEY"

export function alias(providers: Record<string, Provider>) {
  const item = providers.gmicloud
  if (!item || item.env.includes(KEY)) return providers
  return {
    ...providers,
    gmicloud: { ...item, env: [...item.env, KEY] },
  }
}
