import { afterEach, describe, expect, test } from "bun:test"
import path from "path"
import fs from "fs/promises"
import * as Log from "@opencode-ai/core/util/log"
import { Server } from "../../../src/server/server"
import { GlobalBus, type GlobalEvent } from "../../../src/bus/global"
import { resetDatabase } from "../../fixture/db"
import { disposeAllInstances, tmpdir } from "../../fixture/fixture"

void Log.init({ print: false })

afterEach(async () => {
  await disposeAllInstances()
  await resetDatabase()
})

describe("TUI config routes", () => {
  test("gets effective project TUI config", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const cfg = path.join(dir, ".kilo")
        await fs.mkdir(cfg, { recursive: true })
        await Bun.write(
          path.join(cfg, "tui.json"),
          JSON.stringify({ theme: "dracula", keybinds: { app_exit: "ctrl+q" } }, null, 2),
        )
      },
    })

    const response = await Server.Default().app.request("/tui/config", {
      headers: { "x-kilo-directory": tmp.path },
    })

    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      theme?: string
      keybinds?: Record<string, string>
      plugin_origins?: unknown
    }
    expect(body.theme).toBe("dracula")
    expect(body.keybinds?.app_exit).toBe("ctrl+q")
    expect(body.keybinds?.leader).toBe("ctrl+x")
    expect(body.plugin_origins).toBeUndefined()
  })

  test("lists valid TUI keybinds", async () => {
    await using tmp = await tmpdir()

    const response = await Server.Default().app.request("/tui/keybinds", {
      headers: { "x-kilo-directory": tmp.path },
    })

    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      keybinds: Array<{ id: string; default: string; description: string }>
    }
    const ids = new Set(body.keybinds.map((item) => item.id))
    const exit = body.keybinds.find((item) => item.id === "app_exit")
    const suspend = body.keybinds.find((item) => item.id === "terminal_suspend")

    expect(ids.has("leader")).toBe(true)
    expect(ids.has("input_submit")).toBe(true)
    expect(exit?.default).toBe("ctrl+c,ctrl+d,<leader>q")
    expect(exit?.description).toBe("Exit the application")
    expect(suspend?.default).toBe(process.platform === "win32" ? "none" : "ctrl+z")
  })

  test("patches project TUI config", async () => {
    await using tmp = await tmpdir()

    const response = await Server.Default().app.request("/tui/config?scope=project", {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        "x-kilo-directory": tmp.path,
      },
      body: JSON.stringify({ theme: "nord", title_icon: "emojis" }),
    })

    expect(response.status).toBe(200)
    const body = (await response.json()) as { theme?: string; title_icon?: string }
    expect(body.theme).toBe("nord")
    expect(body.title_icon).toBe("emojis")

    const saved = await Bun.file(path.join(tmp.path, ".kilo", "tui.json")).json()
    expect(saved).toEqual({ theme: "nord", title_icon: "emojis" })
  })

  test("patches attention config without dropping advanced notification settings", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const cfg = path.join(dir, ".kilo")
        await fs.mkdir(cfg, { recursive: true })
        await Bun.write(
          path.join(cfg, "tui.json"),
          JSON.stringify(
            {
              attention: {
                enabled: false,
                sound_pack: "custom.pack",
                sounds: { question: "./question.mp3" },
              },
            },
            null,
            2,
          ),
        )
      },
    })

    const response = await Server.Default().app.request("/tui/config?scope=project", {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        "x-kilo-directory": tmp.path,
      },
      body: JSON.stringify({
        attention: { enabled: true, notifications: false, sound: true, volume: 0.25 },
      }),
    })

    expect(response.status).toBe(200)
    const saved = await Bun.file(path.join(tmp.path, ".kilo", "tui.json")).json()
    expect(saved).toEqual({
      attention: {
        enabled: true,
        notifications: false,
        sound: true,
        volume: 0.25,
        sound_pack: "custom.pack",
        sounds: { question: "./question.mp3" },
      },
    })
  })

  test("emits global.config.updated when patching TUI config so open TUIs hot-reload", async () => {
    await using tmp = await tmpdir()

    const events: GlobalEvent[] = []
    const handler = (event: GlobalEvent) => events.push(event)
    GlobalBus.on("event", handler)
    try {
      const response = await Server.Default().app.request("/tui/config?scope=project", {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          "x-kilo-directory": tmp.path,
        },
        body: JSON.stringify({ keybinds: { app_exit: "ctrl+q" } }),
      })
      expect(response.status).toBe(200)
    } finally {
      GlobalBus.off("event", handler)
    }

    expect(events.some((event) => event.payload?.type === "global.config.updated")).toBe(true)
  })
})
