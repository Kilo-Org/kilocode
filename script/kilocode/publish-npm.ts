import { $ } from "bun"
import path from "node:path"
import {
  alreadyPublished,
  refuseStale,
  refuseWithdrawn,
  waitForRegistry,
  type Options,
} from "../../packages/kilo-cli/script/registry-readiness"
import { clients, launcher, tag, verify } from "./npm-tarballs"

export async function publishNpm(
  group: "cli" | "client",
  dir: string,
  version: string,
  expected: string | undefined,
  dryRun: boolean,
  registry: Options = {},
  npm = async (args: string[]) => {
    await $`npm ${args}`
  },
) {
  const all = await verify(dir, version, expected)
  const packages = all.filter(({ name }) => (group === "client" ? clients.includes(name) : !clients.includes(name)))
  const publish = (file: string) =>
    npm([
      "publish",
      path.resolve(dir, file),
      "--ignore-scripts",
      "--access",
      "public",
      "--tag",
      tag,
      ...(dryRun ? ["--dry-run", "--offline"] : ["--provenance"]),
    ])
  if (dryRun) {
    for (const pkg of packages) await publish(pkg.file)
    return
  }
  if (group === "cli")
    await Promise.all([
      refuseWithdrawn(launcher, version, registry),
      ...packages.map((pkg) => refuseStale(pkg.name, version, tag, registry)),
    ])
  // Check the entire group before the first write, including later packages on a partial retry.
  const plan = await Promise.all(packages.map(async (pkg) => ({ pkg, exists: await alreadyPublished(pkg, registry) })))
  async function send({ pkg, exists }: (typeof plan)[number]) {
    if (exists) return console.log(`already published ${pkg.name}@${version} with matching integrity`)
    await publish(pkg.file)
  }
  if (group === "client") {
    for (const entry of plan) await send(entry)
    return
  }
  const platforms = plan.filter(({ pkg }) => pkg.name !== launcher)
  await Promise.all(platforms.map(send))
  await waitForRegistry(
    platforms.map(({ pkg }) => pkg),
    registry,
  )
  await send(plan[plan.length - 1])
}

if (import.meta.main) {
  const [group, dir, flag, ...rest] = Bun.argv.slice(2)
  if ((group !== "cli" && group !== "client") || !dir || (flag && flag !== "--dry-run") || rest.length)
    throw new Error("Usage: publish-npm.ts <cli|client> <tarball directory> [--dry-run]")
  await publishNpm(group, dir, process.env.KILO_VERSION ?? "", process.env.NPM_INVENTORY, flag === "--dry-run")
}
