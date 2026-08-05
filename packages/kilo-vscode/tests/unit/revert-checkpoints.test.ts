import { describe, expect, it } from "bun:test"
import fs from "node:fs"
import path from "node:path"

const ROOT = path.resolve(import.meta.dir, "../..")
const TURN_FILE = path.join(ROOT, "webview-ui/src/components/chat/VscodeSessionTurn.tsx")
const PROVIDER_FILE = path.join(ROOT, "src/KiloProvider.ts")
const BANNER_FILE = path.join(ROOT, "webview-ui/src/components/chat/RevertBanner.tsx")
const SESSION_FILE = path.join(ROOT, "webview-ui/src/types/messages/sessions.ts")
const SDK_FILE = path.join(ROOT, "../sdk/js/src/v2/gen/types.gen.ts")

const src = fs.readFileSync(TURN_FILE, "utf-8")
const provider = fs.readFileSync(PROVIDER_FILE, "utf-8")
const banner = fs.readFileSync(BANNER_FILE, "utf-8")
const session = fs.readFileSync(SESSION_FILE, "utf-8")
const sdk = fs.readFileSync(SDK_FILE, "utf-8")

function method(name: string, next: string) {
  const start = provider.indexOf(`  private async ${name}`)
  const end = provider.indexOf(`  private async ${next}`, start)
  expect(start).toBeGreaterThan(-1)
  expect(end).toBeGreaterThan(start)
  return provider.slice(start, end)
}

describe("message revert checkpoints", () => {
  it("keeps revert actions available after a session is already reverted", () => {
    expect(src).toMatch(/onRevert=\{\s*assistantMessages\(\)\.length > 0\s*\? \(\) =>/)
    expect(src).not.toMatch(/onRevert=\{[\s\S]*?&& !session\.revert\(\)[\s\S]*?\? \(\) =>/)
  })

  it("only marks revert disabled while the agent is busy", () => {
    expect(src).toMatch(/data-revert-disabled=\{\s*assistantMessages\(\)\.length > 0 && session\.status\(\) !== "idle"/)
    expect(src).not.toMatch(/data-revert-disabled=\{[\s\S]*?!session\.revert\(\)/)
  })
})

describe("revert session synchronization", () => {
  it("keeps REST responses as the mutation result", () => {
    const revert = method("handleRevertSession", "handleUnrevertSession")
    const unrevert = method("handleUnrevertSession", "handleCompact")

    expect(revert).toContain("await this.client.session.revert")
    expect(unrevert).toContain("await this.client.session.unrevert")
    expect(revert).toContain('type: "sessionUpdated"')
    expect(unrevert).toContain('type: "sessionUpdated"')
  })

  it("uses ordered sync snapshots instead of duplicate bus snapshots", () => {
    expect(provider).toMatch(/source: "sync"/)
    expect(provider).toMatch(
      /if \(event\.type === "session\.updated"\) return "source" in event && event\.source === "sync"/,
    )
    expect(provider).toMatch(/if \(!isLegacySyncEvent\(event\)\) return/)
    expect(provider).toMatch(/this\.setCurrentSession\(event\.properties\.info\)/)
  })
})

describe("revert workspace restoration status", () => {
  it("renders explicit conversation-only outcomes", () => {
    expect(session).toContain('workspace?: "restored" | "snapshots-disabled" | "unavailable"')
    expect(sdk).toMatch(
      /export type Session = \{[\s\S]*?workspace\?: "restored" \| "snapshots-disabled" \| "unavailable"/,
    )
    expect(sdk).toMatch(
      /export type KilocodeSessionImportSessionData = \{[\s\S]*?workspace\?: "restored" \| "snapshots-disabled" \| "unavailable"/,
    )
    expect(banner).toContain('"revert.banner.workspace.snapshotsDisabled"')
    expect(banner).toContain('"revert.banner.workspace.unavailable"')
  })

  it("opens the checkpoints settings tab when snapshots are disabled", () => {
    expect(banner).toContain('{ type: "openSettingsPanel", tab: "checkpoints" }')
    expect(banner).toContain('"revert.banner.workspace.enableSnapshots"')
  })

  it("uses a legacy notice for reverts without an explicit outcome", () => {
    expect(banner).toContain('"revert.banner.workspace.legacy"')
  })
})
