import { MarketplaceConfig } from "./config"
import { pluginIdentity } from "./plugin-spec"

export * as PluginConfig from "./plugin-config"

// A plugin install owns one spec in the scope's `plugins` array. An append or a replacement edits only that node,
// so comments and formatting in the other entries survive.
export class PluginConfigError extends Error {
  constructor(
    readonly reason: "invalid_params" | "conflict",
    message: string,
  ) {
    super(message)
  }
}

/** The hash of the config value an install writes, as stored in the ownership record. */
export function entryFingerprint(value: unknown): string {
  return MarketplaceConfig.fingerprintValue(value)
}

export function fingerprint(file: string, identity: string) {
  return MarketplaceConfig.serialized(file, async (target) => {
    const values = await matching(plugins(await MarketplaceConfig.read(target), file), identity)
    if (values.length === 0) return undefined
    // Several entries with one identity are duplicates, never the single owned value: hash the list so a scan
    // cannot report one of them as the owned entry.
    return values.length === 1
      ? entryFingerprint(values[0])
      : MarketplaceConfig.fingerprintValue(values.map(entryFingerprint).toSorted())
  })
}

export async function preflight(input: { file: string; identity: string; fingerprints?: readonly string[] }) {
  return MarketplaceConfig.serialized(input.file, async (file) => {
    await check(plugins(await MarketplaceConfig.read(file), input.file), input.file, input.identity, input.fingerprints)
  })
}

export async function write(input: {
  file: string
  spec: string
  identity: string
  replace: boolean
  fingerprints?: readonly string[]
}) {
  return MarketplaceConfig.serialized(input.file, async (file) => {
    const text = await MarketplaceConfig.read(file)
    const data = MarketplaceConfig.parseConfig(text, file) as { plugins?: unknown } | undefined
    const written = pluginsFrom(data, input.file)
    const list = written ?? []
    const index = await indexes(list, input.identity)
    // A non-replacing install never changes an existing array, so it has nothing to check.
    if (index.length > 0 && !input.replace) return
    await check(list, input.file, input.identity, input.fingerprints)
    if (index.length === 0) {
      const next =
        written === undefined
          ? MarketplaceConfig.edit(text, ["plugins"], [input.spec])
          : MarketplaceConfig.edit(text, ["plugins", list.length], input.spec, true)
      return MarketplaceConfig.write(file, next)
    }
    const [first, ...rest] = index
    if (rest.length === 0 && list[first] === input.spec) return
    // Replace or collapse in place; jsonc-parser cannot delete the last element of an array, so a duplicate is
    // dropped by rewriting the array. Comments outside the array always survive.
    const next =
      rest.length === 0
        ? MarketplaceConfig.edit(text, ["plugins", first], input.spec)
        : MarketplaceConfig.edit(
            text,
            ["plugins"],
            list.flatMap((value, position) =>
              position === first ? [input.spec] : index.includes(position) ? [] : [value],
            ),
          )
    await MarketplaceConfig.write(file, next)
  })
}

export async function remove(input: { file: string; identity: string; fingerprints?: readonly string[] }) {
  return MarketplaceConfig.serialized(input.file, async (file) => {
    const text = await MarketplaceConfig.read(file)
    const list = plugins(text, input.file) ?? []
    const index = await indexes(list, input.identity)
    if (index.length === 0) return
    await check(list, input.file, input.identity, input.fingerprints)
    // Rewritten rather than deleted by index: jsonc-parser cannot delete the last element of an array.
    const next = MarketplaceConfig.edit(
      text,
      ["plugins"],
      list.filter((_, position) => !index.includes(position)),
    )
    await MarketplaceConfig.write(file, next)
  })
}

async function check(
  list: readonly unknown[] | undefined,
  file: string,
  identity: string,
  fingerprints: readonly string[] = [],
) {
  for (const value of await matching(list, identity)) {
    if (!fingerprints.includes(entryFingerprint(value)))
      throw new PluginConfigError(
        "conflict",
        `Plugin entry ${identity} in ${file} is modified or not owned by this install`,
      )
  }
}

async function matching(list: readonly unknown[] | undefined, identity: string) {
  const values = list ?? []
  return (await indexes(values, identity)).map((position) => values[position])
}

async function indexes(list: readonly unknown[], identity: string) {
  const identities = await Promise.all(list.map((value) => pluginIdentity(value)))
  return identities.flatMap((value, position) => (value === identity ? [position] : []))
}

/** The array as written, including a malformed non-array value so a caller can report it by name. */
function plugins(text: string, file: string): unknown[] | undefined {
  return pluginsFrom(MarketplaceConfig.parseConfig(text, file) as { plugins?: unknown } | undefined, file)
}

function pluginsFrom(data: { plugins?: unknown } | undefined, file: string): unknown[] | undefined {
  if (!data || data.plugins === undefined) return undefined
  if (!Array.isArray(data.plugins)) throw new PluginConfigError("invalid_params", `${file} has a non-array plugins`)
  return data.plugins
}
