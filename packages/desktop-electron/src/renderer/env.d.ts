// kilocode_change - new file
import type { ElectronAPI } from "../preload/types"

declare global {
  interface Window {
    api: ElectronAPI
    __KILO__?: {
      deepLinks?: string[]
    }
  }
}
