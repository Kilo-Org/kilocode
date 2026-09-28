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
  enabled: !process.env.TEST_DISABLED,
})
await Promise.all(
  Array.from({ length: process.env.TEST_CONCURRENT ? 3 : 1 }, () =>
    Telemetry.updateIdentity("test-token", process.env.TEST_ORG),
  ),
)
if (process.env.TEST_LOGOUT) await Telemetry.updateIdentity(null)
Telemetry.trackCliStart()
await Client.shutdown().catch(() => {})
console.log(JSON.stringify(batches))
process.exit(0)
