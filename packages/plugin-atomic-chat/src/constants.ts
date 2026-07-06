/** Provider id and `kilo.json` key (see https://atomic.chat and models.dev). */
export const ATOMIC_CHAT_PROVIDER_KEY = "atomic-chat" as const

export const DEFAULT_ATOMIC_CHAT_ORIGIN = "http://127.0.0.1:1337"

/** Ports tried when auto-detecting a running Atomic Chat API (default is 1337). */
export const ATOMIC_CHAT_PROBE_PORTS = [1337, 1338] as const

export const LOG_PREFIX = "[@kilocode/plugin-atomic-chat]" as const

export const ATOMIC_CHAT_PLUGIN = "@kilocode/plugin-atomic-chat" as const
