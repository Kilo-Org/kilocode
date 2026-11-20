import path from "node:path"
import { KiloConfigFiles } from "@opencode/util/kilocode/config/files"

export type ProfileRoots = { source: string; data: string; config: string; state: string }

// Only a completed CLI preflight selects the stable profile. Never set process.env in the shared extension host.
export let activeProfile: ProfileRoots | undefined
export function useProfile(profile: ProfileRoots | undefined) {
  activeProfile = profile
}

const release = {
  names: ["kilo.json", "kilo.jsonc"],
  directoryFiles: ["kilo.jsonc", "kilo.json"],
  directories: [".kilo"],
  newFile: "kilo.json",
  writeCandidates(directory: string, global: boolean) {
    const root = this.names.toReversed().map((name) => path.join(directory, name))
    if (global) return root
    return [...this.directoryFiles.toReversed().map((name) => path.join(directory, ".kilo", name)), ...root]
  },
}

export function configFiles() {
  return activeProfile ? release : KiloConfigFiles
}
