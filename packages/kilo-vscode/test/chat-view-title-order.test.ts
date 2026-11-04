import { describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const ROOT = join(import.meta.dir, "..")

type MenuEntry = { command: string; group: string; when: string }

const CHAT_VIEW = "kilo-code.v2.chat"
const ORDER = [
  "kilo-code.v2.newSession",
  "kilo-code.v2.history",
  "kilo-code.v2.agentManager.open",
  "kilo-code.v2.profile",
  "kilo-code.v2.settings",
]

describe("chat view title", () => {
  it("keeps the sidebar button order new session, history, agent manager, profile, settings", () => {
    const manifest = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
      contributes: { menus: { "view/title": MenuEntry[] } }
    }
    const entries = manifest.contributes.menus["view/title"]
      .filter((entry) => entry.when === `view == ${CHAT_VIEW}`)
      .map((entry) => ({ command: entry.command, index: Number(entry.group.split("@")[1]) }))
      .filter((entry) => ORDER.includes(entry.command))
    expect(entries.map((entry) => entry.command)).toEqual(ORDER)
    expect(entries.map((entry) => entry.index)).toEqual(ORDER.map((_, index) => index))
  })
})
