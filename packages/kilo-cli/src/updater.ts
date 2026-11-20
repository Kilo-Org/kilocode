export * as KiloUpdater from "./updater"

import { RetainedImage } from "@opencode/cli/services/retained-image"
import { Updater } from "@opencode/cli/services/updater"
import { OPENCODE_CHANNEL, OPENCODE_VERSION } from "@opencode/cli/version"
import { EffectFlock } from "@opencode/util/effect-flock"
import { Global } from "@opencode/util/global"
import { KiloConfigFiles } from "@opencode/util/kilocode/config/files"
import { AppProcess } from "@opencode/util/process"
import { Effect, FileSystem, Layer, Option, Schema } from "effect"
import { ChildProcess } from "effect/process"
import path from "node:path"
import { stripVTControlCharacters } from "node:util"
import { detect, packageName, registry, type Install } from "./updater-install"
import { isPreview, newer } from "./update-version"

export const tag = "kilo-v2"

export const requireCurrentTarget = (requested: string, published: string) =>
  requested === published
    ? Effect.void
    : Effect.fail(new Error(`Kilo only installs the current ${tag} release (${published}), not ${requested}.`))

const decodeRelease = Schema.decodeUnknownOption(
  Schema.Struct({
    name: Schema.Literal(packageName),
    version: Schema.String,
    optionalDependencies: Schema.Record(Schema.String, Schema.String),
  }),
)
const decodeVersion = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Struct({ name: Schema.Literal(packageName), version: Schema.String })),
)
type Request = (url: string, init: RequestInit) => Promise<Response>

export async function resolveRelease(request: Request = fetch, signal?: AbortSignal) {
  const response = await request(`${registry}/${encodeURIComponent(packageName)}/${tag}`, {
    headers: { accept: "application/json" },
    redirect: "error",
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10_000)]) : AbortSignal.timeout(10_000),
  })
  if (!response.ok) throw new Error(`The Kilo npm registry returned HTTP ${response.status}. Try again later.`)
  const release = Option.getOrUndefined(decodeRelease(await response.json()))
  if (!release || !isPreview(release.version)) throw new Error(`The ${tag} tag did not return a Kilo v2 release.`)
  return release
}

// Do not hand a partially published release to the package manager: a missing optional dependency can be skipped.
async function verifyDownloads(
  release: Awaited<ReturnType<typeof resolveRelease>>,
  request: Request,
  signal: AbortSignal,
) {
  const platform = process.platform === "win32" ? "windows" : process.platform
  const stem = `cli-${platform}-${process.arch}`
  const targets = Object.entries(release.optionalDependencies).filter(([name]) =>
    ["", "-baseline", "-musl", "-baseline-musl"].some((suffix) => name === `@kilocode/${stem}${suffix}`),
  )
  if (
    !targets.some(([name]) => name === `@kilocode/${stem}`) ||
    targets.some(([, version]) => version !== release.version)
  )
    throw new Error(`Kilo ${release.version} has no matching platform packages for ${platform}-${process.arch}.`)
  await Promise.all(
    targets.map(async ([name, version]) => {
      const response = await request(`${registry}/${name}/-/${name.slice("@kilocode/".length)}-${version}.tgz`, {
        headers: { range: "bytes=0-0" },
        redirect: "error",
        signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
      })
      if (!response.ok || !response.body) {
        await response.body?.cancel()
        throw new Error(`${name}@${version} is not yet downloadable (HTTP ${response.status}). Try again later.`)
      }
      const reader = response.body.getReader()
      try {
        if (!(await reader.read()).value?.byteLength)
          throw new Error(`${name}@${version} returned an empty tarball. Try again later.`)
      } finally {
        await reader.cancel()
      }
    }),
  )
}

const message =
  "This copy of Kilo is not managed by a supported global package manager. Update it using its original installer."

function unsupported(channel: string, executable: string) {
  if (channel === "local") return "This is a source build. Update the checkout to get a newer version of Kilo."
  if (path.basename(path.dirname(path.dirname(executable))).endsWith("-alpha"))
    return "Update this native alpha install by running `bun run install:alpha` from the Kilo v2 checkout."
  if (process.env.KILO_CLIENT === "vscode") return "Update the Kilo extension in VS Code to update its bundled server."
  return message
}

export const make = (
  input: { channel: string; version: string; executable: string; request: Request } = {
    channel: OPENCODE_CHANNEL,
    version: OPENCODE_VERSION,
    executable: process.execPath,
    request: fetch,
  },
  detectOwner = detect,
  versionCommand = (manifest: string) => [path.join(path.dirname(manifest), "bin", "kilo.exe"), "--version"],
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const global = yield* Global.Service
    const processRunner = yield* AppProcess.Service
    const flock = yield* EffectFlock.Service
    const enabled = input.channel === "v2" && isPreview(input.version)
    const readPolicy = Effect.forEach(KiloConfigFiles.names, (name) =>
      fs.readFileString(path.join(global.config, name)).pipe(
        Effect.map(Updater.decodePolicy),
        Effect.orElseSucceed(() => undefined),
      ),
    ).pipe(Effect.map((values) => values.findLast((value) => value !== undefined) ?? "notify"))

    const exec = (command: string[], install = false) =>
      processRunner
        .run(
          ChildProcess.make(command[0], command.slice(1), {
            cwd: global.home,
            // The launcher can invoke npm itself if its exact optional dependency was not linked.
            env: install ? { npm_config_registry: registry, "npm_config_@kilocode:registry": registry } : undefined,
            extendEnv: true,
          }),
          {
            timeout: install ? "5 minutes" : "30 seconds",
            maxOutputBytes: 100_000,
            maxErrorBytes: 100_000,
          },
        )
        .pipe(
          Effect.map((result) => ({
            code: result.exitCode,
            stdout: result.stdout.toString(),
            stderr: result.stderr.toString(),
          })),
          Effect.mapError((cause) => new Error(`Could not run ${path.basename(command[0])}.`, { cause })),
        )

    const detectInstall = enabled ? detectOwner(fs, exec, input.executable) : Effect.succeed(undefined)
    const owner = yield* Effect.cached(detectInstall)
    const verifyOwner = (expected: Install) =>
      detectInstall.pipe(
        Effect.flatMap((active) =>
          active?.method === expected.method &&
          active.manifest === expected.manifest &&
          active.lockDirectory === expected.lockDirectory
            ? Effect.succeed(active)
            : Effect.fail(new Error("The Kilo install changed since the update check. Relaunch Kilo and try again.")),
        ),
      )
    const release = () =>
      Effect.tryPromise({
        try: (signal) => resolveRelease(input.request, signal),
        catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
      })
    const onDisk = (install: Install) =>
      (install.installedManifest ?? Effect.succeed(install.manifest)).pipe(
        Effect.flatMap((manifest) =>
          !manifest
            ? Effect.succeed(undefined)
            : fs
                .readFileString(manifest)
                .pipe(
                  Effect.map((text) => ({ manifest, version: Option.getOrUndefined(decodeVersion(text))?.version })),
                ),
        ),
        Effect.orElseSucceed(() => undefined),
      )

    const verifyInstalled = Effect.fnUntraced(function* (manifest: string, version: string) {
      const binary = yield* exec(versionCommand(manifest))
      if (binary.code !== 0 || binary.stdout.trim() !== `kilo v${version}`)
        return yield* Effect.fail(
          new Error(
            `The installed Kilo executable did not report version ${version}. Reinstall it with its original package manager.`,
          ),
        )
    })

    const check = Effect.fn("kilo.updater.check")(function* () {
      const install = yield* owner
      if (!install) return { type: "unavailable" as const, message: unsupported(input.channel, input.executable) }
      const current = yield* onDisk(install)
      if (!current?.version || !isPreview(current.version)) return { type: "unavailable" as const, message }
      if (newer(current.version, input.version)) {
        yield* verifyInstalled(current.manifest, current.version)
        return { type: "installed" as const, version: current.version }
      }
      const candidate = yield* release()
      if (newer(candidate.version, input.version)) return { type: "available" as const, version: candidate.version }
    })

    const prepareRelease = Effect.fnUntraced(function* (install: Install, version: string) {
      const candidate = yield* release()
      yield* requireCurrentTarget(version, candidate.version)
      if (install.scriptsSetting) {
        const setting = yield* exec(install.scriptsSetting)
        if (setting.code !== 0 || /^(true|1)$/i.test(setting.stdout.trim()))
          return yield* Effect.fail(
            new Error(
              `${install.method} must allow Kilo's postinstall script. Update with your package manager after checking its script policy.`,
            ),
          )
      }
      yield* Effect.tryPromise({
        try: (signal) => verifyDownloads(candidate, input.request, signal),
        catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
      })
    })

    const apply = Effect.fn("kilo.updater.apply")(
      function* (version: string, method?: Updater.Method) {
        const install = yield* owner
        if (!install) return yield* Effect.fail(new Error(unsupported(input.channel, input.executable)))
        if (method && method !== install.method)
          return yield* Effect.fail(new Error(`This copy is managed by ${install.method}, not ${method}.`))
        if (!newer(version, input.version))
          return yield* Effect.fail(new Error("Select a newer Kilo v2 preview version."))

        yield* flock
          .acquire("kilo-cli-upgrade", install.lockDirectory, { timeoutMs: 6 * 60_000 })
          .pipe(
            Effect.catchDefect((cause) =>
              Effect.fail(new Error("Could not lock this Kilo installation for an update.", { cause })),
            ),
          )
        const current = yield* onDisk(install)
        if (!current?.version || !isPreview(current.version))
          return yield* Effect.fail(new Error("This package no longer contains Kilo v2."))
        if (version === current.version) return yield* verifyInstalled(current.manifest, version)
        if (!newer(version, current.version))
          return yield* Effect.fail(new Error(`A newer Kilo build (${current.version}) is already installed.`))
        yield* prepareRelease(install, version)
        if (process.platform === "win32" && !(yield* RetainedImage.retain(global.cache, "upgrade")))
          return yield* Effect.fail(
            new Error("Could not retain the running Kilo binary. Exit Kilo and update with its package manager."),
          )

        // A terminal can stay open across installs. Refresh the manager, prefix and bin ownership under the lock.
        const active = yield* verifyOwner(install)
        const result = yield* exec(active.command(version), true)
        if (result.code !== 0) {
          const detail = stripVTControlCharacters(result.stderr || result.stdout)
            .trim()
            .slice(-2000)
          return yield* Effect.fail(
            new Error(`${install.method} could not update Kilo${detail ? `: ${detail}` : ` (exit ${result.code}).`}`),
          )
        }
        const updated = yield* onDisk(active)
        if (updated?.version !== version)
          return yield* Effect.fail(new Error(`${install.method} did not update this copy of Kilo to ${version}.`))
        yield* verifyInstalled(updated.manifest, version)
      },
      (effect) => Effect.scoped(effect).pipe(Effect.provideService(FileSystem.FileSystem, fs)),
    )

    const run = Effect.fn("kilo.updater.run")(
      function* (onInstall?: (version: string) => void) {
        if (!enabled || /^(1|true)$/i.test(process.env.OPENCODE_DISABLE_AUTOUPDATE ?? "")) return
        const policy = yield* readPolicy
        if (policy === "disable") return
        const result = yield* check()
        if (result?.type === "installed") return result
        if (result?.type !== "available") return
        if (policy === "notify") return result
        onInstall?.(result.version)
        yield* apply(result.version)
        return { type: "installed" as const, version: result.version }
      },
      Effect.catch((error) => Effect.logWarning("Kilo update failed", { error }).pipe(Effect.as(undefined))),
    )

    return Updater.Service.of({
      run,
      check,
      apply,
      // Keep uninstall independent from the updater: it does not remove the package manager's files.
      method: () => Effect.succeed(undefined),
      managed: () => Effect.succeed(undefined),
      latest: () =>
        owner.pipe(
          Effect.flatMap((install) =>
            install
              ? release().pipe(Effect.map((candidate) => candidate.version))
              : Effect.fail(new Error(unsupported(input.channel, input.executable))),
          ),
        ),
      upgrade: (method, version) => apply(version, method),
      removal: () => undefined,
    })
  })

export const layer = Layer.effect(Updater.Service, make())
