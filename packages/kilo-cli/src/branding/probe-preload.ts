declare const KILO_REBRAND_COMPILED: boolean

if (process.env.KILO_REBRAND_PROBE === "1" && typeof KILO_REBRAND_COMPILED === "undefined") {
  const { plugin } = await import("bun")
  const { brandingProbe } = await import("./probe-plugin")
  plugin(brandingProbe)
}
