declare const KILO_BRANDING_COMPILED: boolean

if (typeof KILO_BRANDING_COMPILED === "undefined") {
  const { plugin } = await import("bun")
  const { themeRegistryPlugin } = await import("./theme-registry")
  plugin(themeRegistryPlugin)
}

await import("./branding/preload")
