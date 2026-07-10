import { describe, expect } from "bun:test"
import { Effect, Layer, Stream } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import { InstallationChannel } from "@opencode-ai/core/installation/version"
import { AppProcess } from "@opencode-ai/core/process"
import { Installation } from "../../../src/installation"
import { testEffect } from "../../lib/effect"

const encoder = new TextEncoder()

function json(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  })
}

function http(handler: (request: HttpClientRequest.HttpClientRequest) => Response = () => json({})) {
  const client = HttpClient.make((request) => Effect.succeed(HttpClientResponse.fromWeb(request, handler(request))))
  return Layer.succeed(HttpClient.HttpClient, client)
}

function spawner(handler: (cmd: string, args: readonly string[]) => string) {
  const child = ChildProcessSpawner.make((command) => {
    const std = ChildProcess.isStandardCommand(command) ? command : undefined
    const output = handler(std?.command ?? "", std?.args ?? [])
    return Effect.succeed(
      ChildProcessSpawner.makeHandle({
        pid: ChildProcessSpawner.ProcessId(0),
        exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(0)),
        isRunning: Effect.succeed(false),
        kill: () => Effect.void,
        stdin: { [Symbol.for("effect/Sink/TypeId")]: Symbol.for("effect/Sink/TypeId") } as never,
        stdout: output ? Stream.make(encoder.encode(output)) : Stream.empty,
        stderr: Stream.empty,
        all: Stream.empty,
        getInputFd: () => ({ [Symbol.for("effect/Sink/TypeId")]: Symbol.for("effect/Sink/TypeId") }) as never,
        getOutputFd: () => Stream.empty,
        unref: Effect.succeed(Effect.void),
      }),
    )
  })
  return Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, child)
}

function layer(
  handler: (cmd: string, args: readonly string[]) => string,
  request?: (request: HttpClientRequest.HttpClientRequest) => Response,
) {
  const proc = AppProcess.layer.pipe(Layer.provide(spawner(handler)))
  return Installation.layer.pipe(Layer.provide(http(request)), Layer.provide(proc))
}

describe("Kilo installation upgrade", () => {
  const release: string[] = []
  testEffect(
    layer(
      () => "",
      (request) => {
        release.push(request.url)
        return json({ tag_name: "v8.8.8" })
      },
    ),
  ).effect("reads fallback versions from Kilo GitHub releases", () =>
    Effect.gen(function* () {
      const result = yield* Installation.Service.use((svc) => svc.latest("unknown"))
      expect(result).toBe("8.8.8")
      expect(release).toContain("https://api.github.com/repos/Kilo-Org/kilocode/releases/latest")
    }),
  )

  const urls: string[] = []
  testEffect(
    layer(
      () => "",
      (request) => {
        urls.push(request.url)
        return json({ version: "8.8.8" })
      },
    ),
  ).effect("reads yarn versions from the Kilo package registry", () =>
    Effect.gen(function* () {
      const result = yield* Installation.Service.use((svc) => svc.latest("yarn"))
      expect(result).toBe("8.8.8")
      expect(urls).toContain(`https://registry.npmjs.org/@kilocode%2fcli/${InstallationChannel}`)
    }),
  )

  testEffect(
    layer((cmd, args) => {
      if (cmd === "npm" && args.includes("list")) return "@kilocode/cli@7.3.45"
      return ""
    }),
  ).effect("detects npm installs from the Kilo package", () =>
    Effect.gen(function* () {
      const result = yield* Installation.Service.use((svc) => svc.method())
      expect(result).toBe("npm")
    }),
  )

  const choco: string[] = []
  testEffect(
    layer(
      () => "",
      (request) => {
        choco.push(request.url)
        return json({ d: { results: [{ Version: "8.8.8" }] } })
      },
    ),
  ).effect("reads choco versions from the Kilo package", () =>
    Effect.gen(function* () {
      const result = yield* Installation.Service.use((svc) => svc.latest("choco"))
      expect(result).toBe("8.8.8")
      expect(choco).toContain(
        "https://community.chocolatey.org/api/v2/Packages?$filter=Id%20eq%20%27kilo%27%20and%20IsLatestVersion&$select=Version",
      )
    }),
  )

  const scoop: string[] = []
  testEffect(
    layer(
      () => "",
      (request) => {
        scoop.push(request.url)
        return json({ version: "8.8.8" })
      },
    ),
  ).effect("reads scoop versions from the Kilo manifest", () =>
    Effect.gen(function* () {
      const result = yield* Installation.Service.use((svc) => svc.latest("scoop"))
      expect(result).toBe("8.8.8")
      expect(scoop).toContain("https://raw.githubusercontent.com/ScoopInstaller/Main/master/bucket/kilo.json")
    }),
  )

  const calls: string[] = []
  const upgrade = layer((cmd, args) => {
    calls.push([cmd, ...args].join(" "))
    return ""
  })

  testEffect(upgrade).effect("installs the Kilo npm package", () =>
    Effect.gen(function* () {
      yield* Installation.Service.use((svc) => svc.upgrade("npm", "9.9.9"))
      expect(calls).toContain("npm install -g @kilocode/cli@9.9.9")
    }),
  )

  testEffect(upgrade).effect("installs the Kilo yarn package", () =>
    Effect.gen(function* () {
      yield* Installation.Service.use((svc) => svc.upgrade("yarn", "9.9.9"))
      expect(calls).toContain("yarn global add @kilocode/cli@9.9.9")
    }),
  )

  testEffect(upgrade).effect("installs the Kilo pnpm package", () =>
    Effect.gen(function* () {
      yield* Installation.Service.use((svc) => svc.upgrade("pnpm", "9.9.9"))
      expect(calls).toContain("pnpm install -g @kilocode/cli@9.9.9")
    }),
  )

  testEffect(upgrade).effect("installs the Kilo bun package", () =>
    Effect.gen(function* () {
      yield* Installation.Service.use((svc) => svc.upgrade("bun", "9.9.9"))
      expect(calls).toContain("bun install -g @kilocode/cli@9.9.9")
    }),
  )

  const brew: string[] = []
  const brewer = layer((cmd, args) => {
    brew.push([cmd, ...args].join(" "))
    if (cmd === "brew" && args.includes("list")) return "kilo"
    if (cmd === "brew" && args.includes("--repo")) return "/tmp/kilo-homebrew-tap"
    return ""
  })

  testEffect(brewer).effect("upgrades the Kilo brew formula", () =>
    Effect.gen(function* () {
      yield* Installation.Service.use((svc) => svc.upgrade("brew", "9.9.9"))
      expect(brew).toContain("brew tap Kilo-Org/tap")
      expect(brew).toContain("brew upgrade Kilo-Org/tap/kilo")
    }),
  )

  testEffect(upgrade).effect("upgrades the Kilo choco package", () =>
    Effect.gen(function* () {
      yield* Installation.Service.use((svc) => svc.upgrade("choco", "9.9.9"))
      expect(calls).toContain("choco upgrade kilo --version=9.9.9 -y")
    }),
  )

  testEffect(upgrade).effect("installs the Kilo scoop package", () =>
    Effect.gen(function* () {
      yield* Installation.Service.use((svc) => svc.upgrade("scoop", "9.9.9"))
      expect(calls).toContain("scoop install kilo@9.9.9")
    }),
  )

  const curl: string[] = []
  testEffect(
    layer(
      (cmd, args) => {
        curl.push([cmd, ...args].join(" "))
        return ""
      },
      (request) => {
        curl.push(request.url)
        return new Response("#!/usr/bin/env bash", { status: 200 })
      },
    ),
  ).effect("uses the Kilo install script for curl upgrades", () =>
    Effect.gen(function* () {
      yield* Installation.Service.use((svc) => svc.upgrade("curl", "9.9.9"))
      expect(curl).toContain("https://kilo.ai/cli/install")
      expect(curl).toContain("sh")
    }),
  )
})
