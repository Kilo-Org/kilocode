import { afterEach, expect, test } from "bun:test"
import path from "path"
import { Effect, Layer } from "effect"
import { TuiConfig } from "@/cli/cmd/tui/config/tui"
import { CurrentWorkingDirectory } from "@/cli/cmd/tui/config/cwd"
import { tmpdir } from "../../../../../fixture/fixture"

const get = (directory: string) =>
  Effect.runPromise(
    TuiConfig.Service.use((svc) => svc.get()).pipe(
      Effect.provide(TuiConfig.defaultLayer.pipe(Layer.provide(Layer.succeed(CurrentWorkingDirectory, directory)))),
    ),
  )

afterEach(() => {
  delete process.env.KILO_TUI_CONFIG
})

test("KILO_TUI_CONFIG overrides project config", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(path.join(dir, "tui.json"), JSON.stringify({ theme: "project", diff_style: "auto" }))
      const custom = path.join(dir, "custom-tui.json")
      await Bun.write(custom, JSON.stringify({ theme: "custom", diff_style: "stacked" }))
      process.env.KILO_TUI_CONFIG = custom
    },
  })

  const config = await get(tmp.path)
  expect(config.theme).toBe("custom")
  expect(config.diff_style).toBe("stacked")
})
