declare global {
  const KILO_VERSION: string
  const KILO_CHANNEL: string
}

export const InstallationVersion = typeof KILO_VERSION === "string" ? KILO_VERSION : "local"
export const InstallationChannel = typeof KILO_CHANNEL === "string" ? KILO_CHANNEL : "local"
export const InstallationLocal = InstallationChannel === "local"
