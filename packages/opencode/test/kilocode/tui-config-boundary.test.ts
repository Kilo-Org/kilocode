import { expect, test } from "bun:test"
import { fileURLToPath } from "node:url"

test("TUI configuration does not load the terminal renderer", async () => {
  const entry = fileURLToPath(new URL("../../../tui/src/config/index.tsx", import.meta.url))
  const config = fileURLToPath(new URL("../../tsconfig.json", import.meta.url))
  const code = `
    import { createSolidTransformPlugin } from "@opentui/solid/bun-plugin"
    const result = await Bun.build({
      entrypoints: [${JSON.stringify(entry)}],
      target: "bun",
      tsconfig: ${JSON.stringify(config)},
      conditions: ["bun", "node"],
      write: false,
      plugins: [
        createSolidTransformPlugin(),
        {
          name: "config-renderer-boundary",
          setup(build) {
            build.onResolve({ filter: /^@opentui\\/(?:core|solid)(?:\\/|$)/ }, (args) => {
              throw new Error("Configuration loaded the terminal renderer: " + args.path)
            })
          },
        },
      ],
    })
    if (!result.success) throw new AggregateError(result.logs)
  `
  const proc = Bun.spawn([process.execPath, "--eval", code], {
    cwd: fileURLToPath(new URL("../..", import.meta.url)),
    stdout: "pipe",
    stderr: "pipe",
    windowsHide: true,
  })
  const [exit, stderr] = await Promise.all([proc.exited, new Response(proc.stderr).text()])
  expect({ exit, stderr }).toEqual({ exit: 0, stderr: "" })
})
