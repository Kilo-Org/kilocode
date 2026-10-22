import { describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { join, resolve, sep } from "node:path"

const directory = resolve(import.meta.dir, "..")
const schema = resolve(import.meta.dir, "../../schema")
const protocol = resolve(import.meta.dir, "../../protocol")
const core = resolve(import.meta.dir, "../../core")
const server = resolve(import.meta.dir, "../../server")

describe("public import boundaries", () => {
  test("isolates each public entrypoint", async () => {
    const root = await bundleInputs("@opencode-ai/client", "browser")

    expect(dependency(root, "effect")).toEqual([]) // kilocode_change
    expect(within(root, schema)).toEqual([])
    expect(within(root, protocol)).toEqual([])
    expect(within(root, core)).toEqual([])
    expect(within(root, server)).toEqual([])

    const network = await bundleInputs("@opencode-ai/client/effect", "browser")

    expect(dependency(network, "effect").length).toBeGreaterThan(0) // kilocode_change
    expect(within(network, schema).length).toBeGreaterThan(0)
    expect(within(network, protocol).length).toBeGreaterThan(0)
    expect(within(network, core)).toEqual([])
    expect(within(network, server)).toEqual([])
  })
})

async function bundleInputs(specifier: string, target: "browser" | "bun") {
  const temporary = await mkdtemp(join(import.meta.dir, ".import-boundary-"))
  const entrypoint = join(temporary, "index.ts")
  const metafile = join(temporary, "meta.json")
  try {
    await Bun.write(entrypoint, `export * from ${JSON.stringify(specifier)}`)
    const child = Bun.spawn(
      [
        process.execPath,
        "build",
        entrypoint,
        `--target=${target}`,
        "--format=esm",
        "--packages=bundle",
        `--metafile=${metafile}`,
        `--outdir=${join(temporary, "out")}`,
      ],
      { cwd: directory, stdout: "pipe", stderr: "pipe" },
    )
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ])
    if (exitCode !== 0) throw new Error(stdout + stderr)
    const metadata = await Bun.file(metafile).json()
    return Object.keys(metadata.inputs).map((input) => resolve(directory, input))
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
}

function within(inputs: ReadonlyArray<string>, directory: string) {
  const prefix = directory.endsWith(sep) ? directory : directory + sep
  return inputs.filter((input) => input === directory || input.startsWith(prefix))
}

// kilocode_change start - support hoisted dependencies in Windows workspace installs
function dependency(inputs: ReadonlyArray<string>, name: string) {
  return inputs.filter((input) => input.replaceAll("\\", "/").includes(`/node_modules/${name}/`))
}
// kilocode_change end
