// Shared plugin fixture for tests that need to exercise real plugin.config()
// hook behavior without paying the cost of cold-transpiling a fresh .ts file
// per test. Each test references this same file URL via config.plugin with
// tuple options, so Bun's module cache short-circuits after the first import.
//
// Options schema:
//   provider?: Record<string, unknown>          // merged into cfg.provider
//   enabled_providers?: string[]                // replaces cfg.enabled_providers
//   disabled_providers?: string[]               // replaces cfg.disabled_providers
export default {
  id: "test.config-mutator",
  server: async (_input: unknown, options: Record<string, unknown> | undefined) => ({
    async config(cfg: Record<string, unknown>) {
      const opts = options ?? {}
      if (opts.provider && typeof opts.provider === "object") {
        cfg.provider = Object.assign({}, cfg.provider ?? {}, opts.provider)
      }
      if (Array.isArray(opts.enabled_providers)) {
        cfg.enabled_providers = [...opts.enabled_providers]
      }
      if (Array.isArray(opts.disabled_providers)) {
        cfg.disabled_providers = [...opts.disabled_providers]
      }
    },
  }),
}
