export * as ClientManifest from "./client-manifest"

// The package.json that script/kilocode/publish-client.ts publishes for each v2 client package. Kept out of the publish
// script so it can be tested without publishing.

/** The packages this release publishes, in dependency order: protocol depends on schema, client depends on both. */
export const packages = ["schema", "protocol", "client"]

/** The upstream package.json fields the rewrite reads. Other fields are copied unchanged. */
export type Manifest = {
  name: string
  exports: Record<string, unknown>
  dependencies?: Record<string, string>
}

/** `@opencode/<name>` -> `@kilocode/<name>`. The `@opencode` scope on npm belongs to upstream. */
export function kilo(name: string) {
  return name.replace(/^@opencode\//, "@kilocode/")
}

/**
 * Rewrites an upstream manifest for publishing: Kilo name and repository, the release version, `exports` from
 * `./src/*.ts` to the built `./dist/` files, and each `@opencode/*` dependency to an npm alias of the Kilo package with
 * the same version. The aliases keep the built `@opencode/*` imports working.
 *
 * Throws when an upstream sync brings a dependency this release does not publish, or an export it cannot map.
 */
export function manifest(pkg: Manifest, name: string, version: string) {
  const unpublished = Object.keys(pkg.dependencies ?? {}).filter(
    (dep) => dep.startsWith("@opencode/") && !packages.includes(dep.slice("@opencode/".length)),
  )
  if (unpublished.length > 0)
    throw new Error(`${pkg.name} depends on ${unpublished.join(", ")}, which this release does not publish`)
  const exports = Object.entries(pkg.exports)
  const unexpected = exports.filter(([, value]) => !isSource(value))
  if (unexpected.length > 0)
    throw new Error(
      `${pkg.name} has exports that are not ./src/*.ts: ${JSON.stringify(Object.fromEntries(unexpected))}`,
    )
  return {
    ...pkg,
    name: kilo(pkg.name),
    version,
    repository: { type: "git", url: "git+https://github.com/Kilo-Org/kilocode.git", directory: `packages/${name}` },
    exports: Object.fromEntries(
      exports.map(([key, value]) => [
        key,
        {
          import: String(value).replace("./src/", "./dist/").replace(/\.ts$/, ".js"),
          types: String(value).replace("./src/", "./dist/").replace(/\.ts$/, ".d.ts"),
        },
      ]),
    ),
    dependencies: Object.fromEntries(
      Object.entries(pkg.dependencies ?? {}).map(([dep, range]) => [
        dep,
        dep.startsWith("@opencode/") ? `npm:${kilo(dep)}@${version}` : range,
      ]),
    ),
  }
}

function isSource(value: unknown) {
  return typeof value === "string" && value.startsWith("./src/") && value.endsWith(".ts")
}
