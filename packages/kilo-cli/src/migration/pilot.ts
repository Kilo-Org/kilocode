declare const KILO_INTERNAL_PROFILE_CUTOVER_BUILD: boolean

/** Standalone binaries get an immutable capability; only a source checkout reads the runtime opt-in. */
export function pilotEnabled() {
  if (typeof KILO_INTERNAL_PROFILE_CUTOVER_BUILD !== "undefined") return KILO_INTERNAL_PROFILE_CUTOVER_BUILD
  return process.env.KILO_INTERNAL_PROFILE_CUTOVER === "1"
}
