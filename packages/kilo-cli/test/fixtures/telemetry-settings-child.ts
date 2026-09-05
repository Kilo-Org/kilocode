import { TelemetrySettings } from "../../src/telemetry-settings"

const [command, file, value] = process.argv.slice(2)

if (command === "write") {
  await TelemetrySettings.write(file!, { version: 1, enabled: true, endpoint: value })
  process.exit(0)
}

if (command === "read") {
  const settings = await TelemetrySettings.read(file!)
  process.stdout.write(JSON.stringify(settings))
  process.exit(0)
}

process.exit(1)
