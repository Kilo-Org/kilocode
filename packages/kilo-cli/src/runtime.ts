export function requireRuntime(version = Bun.version) {
  if (!Bun.semver.satisfies(version, ">=1.4.0")) {
    throw new Error(
      `Kilo v2 requires Bun 1.4.0 or newer; found ${version}. Use the runtime packaged with dist/interactive/kilo2.`,
    )
  }
}
