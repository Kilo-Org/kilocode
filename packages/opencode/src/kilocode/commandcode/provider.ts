import type { Provider } from "@opencode-ai/core/models-dev"

// Env fix for the live models.dev entry, which declares CMD_API_KEY.
// That was never a real Command Code credential, so Connect would ask for
// a variable that does not exist. The documented key is COMMANDCODE_API_KEY
// (https://commandcode.ai/docs/provider). Only the stale key is swapped out;
// anything else the live entry declares is kept. No-op once models.dev
// carries the right key, then this patch can go away.

const PROVIDER_ID = "commandcode"

const LEGACY_ENV = "CMD_API_KEY"

const CONNECT_ENV = "COMMANDCODE_API_KEY"

export function patch(providers: Record<string, Provider>): Record<string, Provider> {
  const current = providers[PROVIDER_ID]
  if (!current) return providers
  if (current.env.includes(CONNECT_ENV) && !current.env.includes(LEGACY_ENV)) return providers
  return {
    ...providers,
    [PROVIDER_ID]: {
      ...current,
      env: [...current.env.filter((name) => name !== LEGACY_ENV && name !== CONNECT_ENV), CONNECT_ENV],
    },
  }
}
