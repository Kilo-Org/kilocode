// kilocode_change - new file
// Shared derivation for the spawn-capable instance advertisement payload.
// Used by both `kilo remote` (explicit CLI) and `enableRemote()` (covers `/remote`
// and KILO_REMOTE / remote_control auto-enable) so all enable paths advertise
// identically.
import { InstallationVersion } from "@opencode-ai/core/installation/version"
import os from "node:os"
import path from "node:path"
import type { RemoteProtocol } from "@/kilo-sessions/remote-protocol"

function truncate(value: string, max: number) {
  return value.length > max ? value.slice(0, max) : value
}

export function buildInstanceAdvertisement(directory: string): RemoteProtocol.InstanceAdvertisement {
  return {
    name: truncate(os.hostname(), 64),
    projectName: truncate(path.basename(directory) || directory, 64),
    version: truncate(InstallationVersion, 32),
  }
}
