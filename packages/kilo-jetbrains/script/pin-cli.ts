import { Schema } from "effect"
import manifest from "../package.json"

const registry = "https://registry.npmjs.org"
const version = manifest.version
if (!/^0\.0\.0-v2-\d+$/.test(version)) throw new Error(`Expected a pinned v2 CLI build in package.json, got ${version}`)
const targets = ["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64", "windows-arm64", "windows-x64"]
const decode = Schema.decodeUnknownSync(
  Schema.Struct({
    name: Schema.String,
    version: Schema.String,
    dist: Schema.Struct({ integrity: Schema.String }),
  }),
)
const properties = await Promise.all(
  targets.map(async (target) => {
    const name = `@kilocode/cli-${target}`
    const response = await fetch(`${registry}/${name}/${version}`)
    if (!response.ok) throw new Error(`${name}@${version}: ${response.status}`)
    const pkg = decode(await response.json())
    if (pkg.version !== version || pkg.name !== name || !/^sha512-[A-Za-z\d+/]{86}==$/.test(pkg.dist.integrity)) {
      throw new Error(`${name}@${version}: invalid registry metadata`)
    }
    return `cli.integrity.${target}=${pkg.dist.integrity}`
  }),
)
await Bun.write(
  new URL("../backend/src/main/resources/kilo-v2-cli.properties", import.meta.url),
  [
    "# Generated from the pinned npm platform packages by bun run pin:cli.",
    `cli.version=${version}`,
    ...properties,
    "",
  ].join("\n"),
)
