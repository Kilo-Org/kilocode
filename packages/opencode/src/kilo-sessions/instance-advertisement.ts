// kilocode_change - new file
// Shared derivation for the spawn-capable instance advertisement payload.
// Used by both `kilo remote` (explicit CLI) and `enableRemote()` (covers `/remote`
// and KILO_REMOTE / remote_control auto-enable) so all enable paths share
// the same process identity.
import { InstallationVersion } from "@opencode-ai/core/installation/version"
import os from "node:os"
import path from "node:path"
import { performance } from "node:perf_hooks"
import type { RemoteProtocol } from "@/kilo-sessions/remote-protocol"

// Use process startup, not the first advertisement or a later reconnect.
const started = new Date(performance.timeOrigin).toISOString()

function truncate(value: string, max: number) {
  return value.length > max ? value.slice(0, max) : value
}

export function buildInstanceAdvertisement(
  directory: string,
  kind: RemoteProtocol.InstanceAdvertisement["kind"] = "cli",
): RemoteProtocol.InstanceAdvertisement {
  return {
    name: truncate(os.hostname(), 64),
    projectName: truncate(path.basename(directory) || directory, 64),
    version: truncate(InstallationVersion, 32),
    kind,
    startedAt: started,
  }
}
