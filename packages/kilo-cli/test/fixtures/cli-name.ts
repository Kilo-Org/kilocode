if (process.env.KILO_NAME_TEST_PREDEFINED)
  Object.defineProperty(globalThis, "OPENCODE_CLI_NAME", {
    value: process.env.KILO_NAME_TEST_PREDEFINED,
    configurable: true,
  })

if (process.env.KILO_NAME_TEST_HOSTED === "1") await import("../../src/preload")

const { Commands } = await import("@opencode/cli/commands/commands")
const nested = process.env.KILO_NAME_TEST_CHILD === "1" ? await childName() : undefined
console.log(
  JSON.stringify({
    name: Commands.name,
    spec: Commands.spec.name,
    nested,
    env: {
      home: process.env.HOME,
      userProfile: process.env.USERPROFILE,
      testHome: process.env.OPENCODE_TEST_HOME,
      config: process.env.XDG_CONFIG_HOME,
      data: process.env.XDG_DATA_HOME,
      state: process.env.XDG_STATE_HOME,
      cache: process.env.XDG_CACHE_HOME,
      bunOptions: process.env.BUN_OPTIONS,
      branding: process.env.KILO_BRANDING_TEST_HOSTED,
      opencodeConfig: process.env.OPENCODE_CONFIG,
    },
  }),
)

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
