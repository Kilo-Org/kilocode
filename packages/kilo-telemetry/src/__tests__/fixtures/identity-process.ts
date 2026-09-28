const batches: { event: string; distinct_id: string; properties: Record<string, unknown> }[] = []
globalThis.fetch = Object.assign(
  async (_url: string | URL | Request, options?: RequestInit) => {
    if (typeof options?.body !== "string") throw new Error("Expected a JSON telemetry batch")
    const body = JSON.parse(options.body)
    batches.push(...(body.batch ?? []))
    return new Response("{}", { status: process.env.TEST_FAIL ? 400 : 200 })
  },
  { preconnect() {} },
)

// Install the transport before importing the SDK, which captures fetch at import time.
const { Telemetry } = await import("../../telemetry")
const { Client } = await import("../../client")

await Telemetry.init({
  dataPath: process.env.TEST_DATA!,
  version: process.env.TEST_VERSION ?? "1.0.0",
  enabled: true,
})
if (process.env.TEST_LOGIN) Telemetry.trackCliStart()
// Overlapping auth checks must not enqueue the same alias twice.
await Promise.all([
  Telemetry.updateIdentity("test-token", process.env.TEST_ORG),
  Telemetry.updateIdentity("test-token", process.env.TEST_ORG),
])
if (process.env.TEST_LOGIN) {
  Telemetry.trackAuthSuccess("kilo")
  Telemetry.trackCliExit()
} else {
  Telemetry.trackCliStart()
}
await Client.shutdown().catch(() => {})
console.log(JSON.stringify(batches))
process.exit(0)
