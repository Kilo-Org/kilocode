// One engine process run: start, resolve the identity of a signed-in token, track, and drain the queue on exit.
import { Client } from "../../src/client"
import { Telemetry } from "../../src/telemetry"

const env = process.env
await Telemetry.init({
  dataPath: env.TEST_DATA!,
  version: env.TEST_VERSION ?? "1.0.0",
  enabled: env.TEST_ENABLED !== "0",
  host: env.TEST_POSTHOG,
})
if (env.TEST_LOGIN) Telemetry.trackCliStart()
// Overlapping auth checks must not enqueue the same alias twice.
await Promise.all([
  Telemetry.updateIdentity("test-token", env.TEST_ORG, env.TEST_API),
  Telemetry.updateIdentity("test-token", env.TEST_ORG, env.TEST_API),
])
if (env.TEST_LOGIN) {
  Telemetry.trackAuthSuccess("kilo")
  Telemetry.trackCliExit()
}
if (!env.TEST_LOGIN) Telemetry.trackCliStart()
await Client.shutdown().catch((error: unknown) => {
  if (!env.TEST_FAIL) throw error
})
process.exit(0)
