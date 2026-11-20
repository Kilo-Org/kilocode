import { KiloConfigFiles } from "@opencode/util/kilocode/config/files"

export type ProfileRoots = { source: string; data: string; config: string; state: string; fresh?: true }

// Use the CLI's verified selectors without changing process.env in the shared extension host.
export let activeProfile: ProfileRoots | undefined
export function useProfile(profile: ProfileRoots | undefined) {
  activeProfile = profile
}

export function configFiles() {
  return KiloConfigFiles
}
