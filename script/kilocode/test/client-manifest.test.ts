import { describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import path from "node:path"
import { ClientManifest } from "../client-manifest"

const root = path.resolve(import.meta.dir, "..", "..", "..")
const version = "0.0.0-v2-9"

describe("client manifest", () => {
  for (const name of ClientManifest.packages) {
    test(`rewrites packages/${name} for npm`, async () => {
      const dir = path.join(root, "packages", name)
      const pkg: ClientManifest.Manifest = await Bun.file(path.join(dir, "package.json")).json()
      const result = ClientManifest.manifest(pkg, name, version)

      expect(result.name).toBe(`@kilocode/${name}`)
      expect(result.version).toBe(version)
      expect(result.repository.directory).toBe(`packages/${name}`)

      // Every export points at the built file of a source module that exists.
      for (const [key, source] of Object.entries(pkg.exports)) {
        const built = String(source).replace("./src/", "./dist/")
        expect(result.exports[key]).toEqual({
          import: built.replace(/\.ts$/, ".js"),
          types: built.replace(/\.ts$/, ".d.ts"),
        })
        const file = path.join(dir, String(source))
        expect(existsSync(file.includes("*") ? path.dirname(file) : file)).toBe(true)
      }

      // `@opencode/*` dependencies become aliases of Kilo packages from the same release. Others stay unchanged.
      for (const [dep, range] of Object.entries(pkg.dependencies ?? {})) {
        expect(result.dependencies[dep]).toBe(
          dep.startsWith("@opencode/") ? `npm:@kilocode/${dep.slice("@opencode/".length)}@${version}` : range,
        )
      }
    })
  }

  test("client depends on the protocol and schema aliases", async () => {
    const pkg = await Bun.file(path.join(root, "packages", "client", "package.json")).json()
    const result = ClientManifest.manifest(pkg, "client", version)
    expect(result.dependencies["@opencode/protocol"]).toBe(`npm:@kilocode/protocol@${version}`)
    expect(result.dependencies["@opencode/schema"]).toBe(`npm:@kilocode/schema@${version}`)
  })

  test("rejects a dependency this release does not publish", () => {
    expect(() =>
      ClientManifest.manifest(
        { name: "@opencode/client", exports: {}, dependencies: { "@opencode/util": "workspace:*" } },
        "client",
        version,
      ),
    ).toThrow("@opencode/util")
  })

  test("rejects exports that are not source modules", () => {
    expect(() =>
      ClientManifest.manifest(
        { name: "@opencode/client", exports: { ".": { import: "./dist/index.js" } } },
        "client",
        version,
      ),
    ).toThrow("not ./src/*.ts")
  })
})
