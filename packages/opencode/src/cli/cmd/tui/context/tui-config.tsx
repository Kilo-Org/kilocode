// kilocode_change start - reactive TUI config provider enables hot reload (impl in kilocode mirror)
import { KiloTuiConfig } from "@/kilocode/cli/cmd/tui/context/tui-config"

export const useTuiConfig = KiloTuiConfig.use
export const TuiConfigProvider = KiloTuiConfig.Provider
// kilocode_change end
