declare global {
  const KILO_VERSION: string
  const KILO_CHANNEL: string
}

export const VERSION = typeof KILO_VERSION === "string" ? KILO_VERSION : "local"
export const CHANNEL = typeof KILO_CHANNEL === "string" ? KILO_CHANNEL : "local"
