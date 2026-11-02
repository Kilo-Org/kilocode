import { mkdir, writeFile } from "node:fs/promises"
import { dirname, join, relative } from "node:path"
import { DriverRequest, DriverResult, FixtureDescriptor, SCHEMA_VERSION, type Assertion } from "../src/schema"
import { isLoopback } from "../src/env"
import { readJsonAs, writeJson } from "../src/protocol"
import { args } from "./cli"

export type DriverMode = "normal" | "crash" | "invalid" | "secret" | "slow" | "capability" | "fail"

async function hash(file: string) {
  return new Bun.CryptoHasher("sha256").update(await Bun.file(file).arrayBuffer()).digest("hex")
}

async function artifact(dir: string, name: string, content: string) {
  const file = join(dir, name)
  await mkdir(dirname(file), { recursive: true, mode: 0o700 })
  await writeFile(file, content)
  return file
}

export async function driver(mode: DriverMode) {
  const { request: requestPath, result: resultPath } = args()
  if (mode === "crash") process.exit(42)
  if (mode === "slow") await Bun.sleep(60_000)

  const request = await readJsonAs(requestPath, DriverRequest)
  if (mode === "invalid") {
    await writeJson(resultPath, { schemaVersion: SCHEMA_VERSION })
    return
  }

  const startedAt = new Date().toISOString()
  const descriptor = await readJsonAs(request.descriptorPath, FixtureDescriptor)
  const env = process.env
  const token = request.scenario.expected.terminalTranscriptToken

  const assertions: Assertion[] = [
    { name: "descriptor.available", status: "passed" },
    {
      name: "environment.loopback",
      status: isLoopback(env.KILO_API_URL ?? "") ? "passed" : "failed",
    },
    {
      name: "environment.credentials",
      status: env.KILO_API_KEY === descriptor.credentials.apiKey ? "passed" : "failed",
    },
    {
      name: "project.commit",
      status: /^[0-9a-f]{40}$/.test(request.project.commit) ? "passed" : "failed",
    },
    {
      name: "scenario.token",
      status: token === request.scenario.prompt.token ? "passed" : "failed",
    },
  ]

  for (const name of [...request.scenario.expected.ui, ...request.scenario.expected.model]) {
    assertions.push({ name, status: "passed" })
  }

  if (mode === "fail") {
    const index = assertions.findIndex((assertion) => assertion.name === request.scenario.expected.ui[0])
    if (index >= 0) assertions[index] = { name: assertions[index].name, status: "failed" }
  }

  const logs = await artifact(join(request.artifactsDir, "logs"), "driver.log", "fake driver log\n")
  const screenshot = await artifact(
    join(request.artifactsDir, "screenshots"),
    "session.txt",
    `scenario ${request.scenario.id}\n`,
  )
  const snapshot = await artifact(
    join(request.artifactsDir, "snapshots"),
    "state.json",
    `${JSON.stringify({ scenario: request.scenario.id, token })}\n`,
  )
  const toRelative = (file: string) => relative(request.runDir, file)

  const base: DriverResult = {
    schemaVersion: SCHEMA_VERSION,
    runId: request.runId,
    scenarioId: request.scenario.id,
    lane: request.scenario.lane,
    driver: { id: "fake-driver", version: "0.0.0" },
    ide: { name: "fake-ide", version: "0.0.0" },
    provenance: {
      clientHash: await hash(import.meta.filename),
      cliHash: await hash(request.descriptorPath),
    },
    capabilities: mode === "capability" ? [] : request.scenario.requires,
    outcome: assertions.every((assertion) => assertion.status === "passed") ? "passed" : "failed",
    startedAt,
    endedAt: new Date().toISOString(),
    assertions,
    lastState: {
      lane: request.scenario.lane,
      scenario: request.scenario.id,
      projectCommit: request.project.commit,
      terminal: token,
    },
    artifacts: {
      logs: [toRelative(logs)],
      screenshots: [toRelative(screenshot)],
      snapshots: [toRelative(snapshot)],
    },
  }

  if (mode === "secret") {
    await writeJson(resultPath, { ...base, lastState: { ...base.lastState, authorization: "Bearer sk-live-secret" } })
    return
  }

  await writeJson(resultPath, DriverResult.parse(base))
}
