// Prints what the TUI's theme and local plugin discovery finds from the working directory. It imports the upstream
// modules by their upstream paths, as the TUI and `plugin list` do, so the result shows which files the loader
// supplied: the upstream ones, or the host mirrors (the host preload at runtime, `hostMirrorsPlugin` in a build).
declare const KILO_BRANDING_COMPILED: boolean

if (typeof KILO_BRANDING_COMPILED === "undefined" && process.env.KILO_DISCOVERY_TEST_HOSTED === "1")
  await import("../../src/preload")

const { configDirectories } = await import("../../../tui/src/util/config-directories")
const { discoverPluginTargets, localPluginDirectories } = await import("../../../tui/src/plugin/discovery")
const { discoverThemes } = await import("../../../tui/src/theme/discovery")

const config = process.env.KILO_DISCOVERY_TEST_CONFIG!
const directories = await localPluginDirectories(process.cwd(), config)
console.log(
  JSON.stringify({
    themes: await discoverThemes(configDirectories(config, process.cwd())),
    directories,
    plugins: await discoverPluginTargets(directories),
  }),
)
