import path from "node:path"

export function legacyRoots(home: string, configBase: string) {
  const dot = [path.join(home, ".kilocode"), path.join(home, ".kilo")]
  const storage = new Set(
    [
      configBase,
      path.join(home, ".config"),
      path.join(home, "Library", "Application Support"),
      path.join(home, "AppData", "Roaming"),
    ].flatMap((base) =>
      ["Code", "Code - Insiders"].map((app) => path.join(base, app, "User", "globalStorage", "kilocode.kilo-code")),
    ),
  )
  const modes = [
    path.join(home, ".kilocodemodes"),
    path.join(home, ".kilocode/cli/global/settings/custom_modes.yaml"),
    ...[...storage].map((dir) => path.join(dir, "settings/custom_modes.yaml")),
  ]
  return { dot, storage, modes }
}
