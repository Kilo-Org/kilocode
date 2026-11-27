declare const KILO_BRANDING_COMPILED: boolean

if (typeof KILO_BRANDING_COMPILED === "undefined") {
  const { plugin } = await import("bun")
  const { brandingPlugin } = await import("./plugin")
  const { ensureCachedSolidTransformPlugin } = await import("./solid-cache")
  plugin(brandingPlugin)
  ensureCachedSolidTransformPlugin()
}
