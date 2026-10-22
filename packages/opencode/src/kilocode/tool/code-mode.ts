// kilocode_change - new file

type Flags = { experimentalCodeMode: boolean }
type Settings = { experimental?: { code_mode?: boolean } }

export namespace KiloCodeMode {
  export function wanted(flags: Flags, cfg: Settings) {
    return flags.experimentalCodeMode || cfg.experimental?.code_mode === true
  }

  export async function load(flags: Flags, cfg: Settings) {
    if (!wanted(flags, cfg)) return undefined
    return import("@/tool/code-mode")
  }
}
