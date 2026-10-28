if (process.env.KILO_NAME_TEST_PREDEFINED)
  Object.defineProperty(globalThis, "OPENCODE_CLI_NAME", {
    value: process.env.KILO_NAME_TEST_PREDEFINED,
    configurable: true,
  })

if (process.env.KILO_NAME_TEST_HOSTED === "1") await import("../../src/preload")

const { Commands } = await import("@opencode/cli/commands/commands")
const nested = process.env.KILO_NAME_TEST_CHILD === "1" ? await childName() : undefined
console.log(JSON.stringify({ name: Commands.name, spec: Commands.spec.name, nested }))

async function childName() {
  const { selfCommand } = await import("@opencode/cli/util/process")
  const child = Bun.spawn(selfCommand(), {
    env: { ...process.env, KILO_NAME_TEST_CHILD: "0" },
    stdout: "pipe",
    stderr: "pipe",
    timeout: 30_000,
  })
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  if (code !== 0 || stderr) throw new Error(`Child command failed: ${code}\n${stderr}`)
  return JSON.parse(stdout) as { name: string; spec: string }
}
