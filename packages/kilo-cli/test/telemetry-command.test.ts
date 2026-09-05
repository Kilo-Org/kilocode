import { expect, test } from "bun:test"
import { stat } from "node:fs/promises"
import path from "node:path"
import { parseCommand } from "../src/commands"
import { fixture, ready, type Fixture } from "./fixture"

const entry = path.resolve(import.meta.dir, "../src/tui-preview.ts")

function start(input: Fixture, args: string[], env: NodeJS.ProcessEnv = {}) {
  return Bun.spawn([process.execPath, "--no-env-file", "--preload", "@opentui/solid/preload", entry, ...args], {
    cwd: input.cwd,
    env: { ...input.env, ...env },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    timeout: 20000,
  })
}

async function command(input: Fixture, args: string[], env?: NodeJS.ProcessEnv) {
  const child = start(input, args, env)
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  return { code, stdout, stderr }
}

test("telemetry command validates explicit consent and never prints collector credentials", async () => {
  for (const args of [
    ["telemetry"],
    ["telemetry", "enable"],
    ["telemetry", "status", "--endpoint", "https://example.test"],
    ["telemetry", "disable", "extra"],
  ])
    expect(() => parseCommand(args)).toThrow()
  await using input = await fixture()
  const file = path.join(input.env.XDG_CONFIG_HOME, "kilo2/interactive/telemetry.json")
  const initial = await command(input, ["telemetry", "status"])
  expect(initial.stderr).toBe("")
  expect(initial.code).toBe(0)
  expect(JSON.parse(initial.stdout)).toMatchObject({ enabled: false, appliesTo: "next-host-start", file })
  expect(await Bun.file(file).exists()).toBe(false)
  const invalid = await command(input, ["telemetry", "enable", "--endpoint", "file:///tmp/collector"])
  expect(invalid.code).toBe(1)
  expect(await Bun.file(file).exists()).toBe(false)
  const enabled = await command(input, ["telemetry", "enable", "--endpoint", "https://collector.test/private-secret"])
  expect(enabled.code).toBe(0)
  expect(JSON.parse(enabled.stdout).enabled).toBe(true)
  expect(enabled.stdout + enabled.stderr).not.toContain("private-secret")
  expect((await stat(file)).mode & 0o777).toBe(0o600)
  expect(await Bun.file(path.join(input.env.XDG_DATA_HOME, "kilo2/interactive/kilo2.db")).exists()).toBe(false)
  expect((await command(input, ["telemetry", "disable"])).code).toBe(0)
  const declined = await command(input, ["telemetry", "status"], {
    KILO_TELEMETRY_ENABLED: "1",
    KILO_TELEMETRY_ENDPOINT: "http://127.0.0.1:1",
  })
  expect(JSON.parse(declined.stdout).enabled).toBe(false)
}, 30000)

test("foreground and daemon startup honor persisted consent and refuse changing a live exporter", async () => {
  await using input = await fixture()
  const received: string[] = []
  const arrival = Promise.withResolvers<void>()
  const collector = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      expect(new URL(request.url).pathname).toBe("/v1/logs")
      received.push(await request.text())
      arrival.resolve()
      return new Response("{}")
    },
  })
  const opted = { KILO_TELEMETRY_ENABLED: "1", KILO_TELEMETRY_ENDPOINT: collector.url.toString() }
  try {
    expect((await command(input, ["telemetry", "enable", "--endpoint", collector.url.toString()])).code).toBe(0)
    const host = start(input, ["serve"])
    const errors = new Response(host.stderr).text()
    try {
      await ready(host.stdout, /URL: (http:\/\/127\.0\.0\.1:\d+)/)
      await Promise.race([
        arrival.promise,
        new Promise((_, reject) => setTimeout(() => reject(new Error("No telemetry")), 5000)),
      ])
      const refused = await command(input, ["telemetry", "disable"])
      expect(refused.code).toBe(1)
      expect(refused.stderr).toContain("Stop the Kilo TUI or daemon")
      expect(JSON.parse((await command(input, ["telemetry", "status"])).stdout).enabled).toBe(true)
    } finally {
      host.kill("SIGTERM")
      await host.exited
      await errors
    }
    expect(received.join("\n")).toContain("server.connected")
    expect((await command(input, ["service", "start"])).code).toBe(0)
    expect((await command(input, ["telemetry", "disable"])).code).toBe(1)
    expect((await command(input, ["service", "stop"])).code).toBe(0)
    expect((await command(input, ["telemetry", "disable"])).code).toBe(0)
    const previous = received.length
    expect((await command(input, ["service", "start"], opted)).code).toBe(0)
    expect((await command(input, ["service", "stop"])).code).toBe(0)
    expect(received.length).toBe(previous)
  } finally {
    await command(input, ["service", "stop"])
    await collector.stop(true)
  }
}, 60000)
