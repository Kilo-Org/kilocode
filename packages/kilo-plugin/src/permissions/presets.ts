import type { KiloPermissionsRpc } from "@opencode/schema/kilocode/permissions"
import { FSUtil } from "@opencode/util/fs-util"
import path from "path"
import { Effect, Option, Schema } from "effect"

const PackageManifest = Schema.Struct({
  packageManager: Schema.optionalKey(Schema.String),
  dependencies: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
  devDependencies: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
  name: Schema.optionalKey(Schema.String),
})
type PackageManifest = typeof PackageManifest.Type
const decodeManifest = Schema.decodeUnknownOption(Schema.fromJsonString(PackageManifest))

const PackageManager = Schema.Literals(["bun", "npm", "pnpm", "yarn"])
export type PackageManager = typeof PackageManager.Type
const decodeManager = Schema.decodeUnknownOption(PackageManager)

export interface Catalog {
  readonly presets: readonly KiloPermissionsRpc.Preset[]
  readonly defaultID?: KiloPermissionsRpc.PresetID
}

export interface Classification {
  readonly manager: PackageManager
  readonly kilo: boolean
}

const lockfiles: ReadonlyArray<readonly [string, PackageManager]> = [
  ["bun.lock", "bun"],
  ["bun.lockb", "bun"],
  ["pnpm-lock.yaml", "pnpm"],
  ["yarn.lock", "yarn"],
  ["package-lock.json", "npm"],
]

const genericStems = (manager: PackageManager) => [
  `${manager} run test`,
  `${manager} run typecheck`,
  `${manager} run lint`,
  `${manager} run check`,
  `${manager} run build`,
  `${manager} test`,
  ...(manager === "bun" || manager === "pnpm" || manager === "yarn"
    ? [`${manager} typecheck`, `${manager} lint`, `${manager} check`, `${manager} build`]
    : []),
  `${manager} --version`,
  `${manager} -v`,
  `${manager} --help`,
  `${manager} -h`,
  `${manager} help`,
  "node --version",
  "node -v",
]

// Output helpers agents chain onto a check or install to trim or report its output. Their wildcards would also match
// a redirected file write; `covers` in rules.ts refuses those, so they stay read-only.
const outputStems = ["tail", "head", "grep", "echo", "ls"] as const

const kiloStems = [
  "bun run typecheck:tsc",
  "bun typecheck:tsc",
  "bun run check:architecture",
  "bun run check:duplication",
  "bun run check:generated",
  "bun run lint:changed",
  "bun script/kilocode/metrics/check.ts",
] as const

function resources(stems: readonly string[]) {
  return [...new Set(stems.map((stem) => `${stem} *`))]
}

function checkResources(manager: PackageManager, kilo: boolean) {
  return resources([...genericStems(manager), ...(kilo ? kiloStems : []), ...outputStems])
}

// Sets are additive, so the install set holds only the install commands and is applied alongside a checks set.
function installResources(manager: PackageManager) {
  const install = [`${manager} install`]
  if (manager === "npm") install.push("npm ci")
  if (manager === "bun" || manager === "pnpm" || manager === "yarn") install.push(`${manager} add`)
  // bun, npm and pnpm accept `i` for `install`; yarn does not.
  if (manager !== "yarn") install.push(`${manager} i`)
  return resources([...install, ...outputStems])
}

export function classify(input: Classification): Catalog {
  const install = { id: "dependency-install" as const, resources: installResources(input.manager) }
  if (input.kilo) {
    return {
      presets: [
        { id: "kilo-bun-checks", resources: checkResources(input.manager, true) },
        { id: "typescript-checks", resources: checkResources(input.manager, false) },
        install,
      ],
      defaultID: "kilo-bun-checks",
    }
  }
  return {
    presets: [{ id: "typescript-checks", resources: checkResources(input.manager, false) }, install],
    defaultID: "typescript-checks",
  }
}

export const catalog = Effect.fn("KiloPermissions.catalog")(function* (fs: FSUtil.Interface, root: string) {
  const packageManifest = yield* readManifest(fs, path.join(root, "package.json"))
  if (packageManifest === undefined) return emptyCatalog()

  const manager = yield* detectManager(fs, root, packageManifest.packageManager)
  if (manager === undefined) return emptyCatalog()

  const hasTypescript =
    (yield* fileExists(fs, path.join(root, "tsconfig.json"))) || hasTypeScriptDependency(packageManifest)
  if (!hasTypescript) return emptyCatalog()

  const kilo =
    manager === "bun" &&
    (yield* readManifest(fs, path.join(root, "packages/kilo-cli/package.json")))?.name === "@kilocode/kilo-cli" &&
    (yield* readManifest(fs, path.join(root, "packages/kilo-plugin/package.json")))?.name === "@kilocode/kilo-plugin"
  return classify({ manager, kilo })
})

function emptyCatalog(): Catalog {
  return { presets: [] }
}

function hasTypeScriptDependency(manifest: PackageManifest) {
  return [manifest.dependencies, manifest.devDependencies].some(
    (dependencies) =>
      dependencies !== undefined && ("typescript" in dependencies || "@typescript/native" in dependencies),
  )
}

function detectManager(
  fs: FSUtil.Interface,
  root: string,
  packageManager: string | undefined,
): Effect.Effect<PackageManager | undefined, FSUtil.Error> {
  if (packageManager !== undefined)
    return Effect.succeed(Option.getOrUndefined(decodeManager(packageManager.split("@")[0])))
  return Effect.gen(function* () {
    for (const [filename, manager] of lockfiles) {
      if (yield* fileExists(fs, path.join(root, filename))) return manager
    }
    return "npm" as const
  })
}

function readManifest(
  fs: FSUtil.Interface,
  filename: string,
): Effect.Effect<PackageManifest | undefined, FSUtil.Error> {
  return fs.readFileString(filename).pipe(
    Effect.map((content) => Option.getOrUndefined(decodeManifest(content))),
    Effect.catchIf(isNotFound, () => Effect.succeed(undefined)),
  )
}

function fileExists(fs: FSUtil.Interface, filename: string): Effect.Effect<boolean, FSUtil.Error> {
  return fs.stat(filename).pipe(
    Effect.map((info) => info.type === "File"),
    Effect.catchIf(isNotFound, () => Effect.succeed(false)),
  )
}

function isNotFound(error: FSUtil.Error) {
  return "reason" in error && error.reason._tag === "NotFound"
}
