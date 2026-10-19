import { OPENCODE_CHANNEL, OPENCODE_VERSION } from "@opencode/cli/version"

/**
 * Kilo's app identity: the Kilo name, with the version and channel of this build. A release build defines the
 * version and channel at build time, as for the upstream CLI. A client that starts the host can set its own name
 * with `KILO_CLIENT` (see ./env).
 */
export const KiloApp = {
  name: process.env.OPENCODE_CLIENT ?? "kilo",
  version: OPENCODE_VERSION,
  channel: OPENCODE_CHANNEL,
}
