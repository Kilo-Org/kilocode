declare global {
  const KILO_VERSION: string
  const KILO_CHANNEL: string
  const KILO_BUILD_KIND: string // kilocode_change
}

export const InstallationVersion = typeof KILO_VERSION === "string" ? KILO_VERSION : "local"
export const InstallationChannel = typeof KILO_CHANNEL === "string" ? KILO_CHANNEL : "local"
export const InstallationLocal = InstallationChannel === "local"
// kilocode_change start - distinguish release builds from source / local builds
export const InstallationBuildKind: "source" | "release" =
  typeof KILO_BUILD_KIND === "string" && KILO_BUILD_KIND === "release" ? "release" : "source"
// kilocode_change end
