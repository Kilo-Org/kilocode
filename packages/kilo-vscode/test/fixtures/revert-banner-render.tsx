import assert from "node:assert/strict"
import { Window } from "happy-dom"

const window = new Window({ url: "http://localhost" })
Object.assign(globalThis, {
  window,
  document: window.document,
  navigator: window.navigator,
  Node: window.Node,
  Element: window.Element,
  HTMLElement: window.HTMLElement,
  HTMLButtonElement: window.HTMLButtonElement,
  SVGElement: window.SVGElement,
  MutationObserver: window.MutationObserver,
  ResizeObserver: window.ResizeObserver,
  getComputedStyle: window.getComputedStyle.bind(window),
  matchMedia: window.matchMedia.bind(window),
  requestAnimationFrame: window.requestAnimationFrame.bind(window),
  cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
})

const posted: unknown[] = []
Object.assign(globalThis, {
  acquireVsCodeApi: () => ({
    postMessage: (msg: unknown) => posted.push(msg),
    getState: () => undefined,
    setState: () => undefined,
  }),
})

const { createSignal } = await import("solid-js")
const { render } = await import("solid-js/web")
const { ClipboardProvider } = await import("@kilocode/kilo-ui/context/clipboard")
const { DialogProvider } = await import("@kilocode/kilo-ui/context/dialog")
const { I18nProvider } = await import("@kilocode/kilo-ui/context/i18n")
const { dict: uiEn } = await import("../../../ui/src/i18n/en")
const { dict: kiloEn } = await import("@kilocode/kilo-ui/i18n/en")
const { LanguageContext } = await import("../../webview-ui/src/context/language")
const { VSCodeProvider } = await import("../../webview-ui/src/context/vscode")
const { resolveTemplate } = await import("../../webview-ui/src/context/language-utils")
const { dict: appEn } = await import("../../webview-ui/src/i18n/en")
const { RevertBanner } = await import("../../webview-ui/src/components/chat/RevertBanner")
const { TranscriptRowView } = await import("../../webview-ui/src/v2/transcript-row")
import type { SessionRevert } from "@opencode/client"
import type { TranscriptRow } from "../../webview-ui/src/v2/transcript"

const merged = { ...uiEn, ...kiloEn, ...appEn } as Record<string, string>
const t = (key: string, params?: Record<string, string | number | boolean | undefined>) =>
  resolveTemplate(merged[key] ?? key, params)

const language = {
  locale: () => "en" as const,
  setLocale: () => undefined,
  userOverride: () => "" as const,
  t,
}

const host = document.createElement("div")
document.body.append(host)

const [revert, setRevert] = createSignal<SessionRevert>({
  messageID: "msg_1",
  workspace: "restored",
  files: [{ file: "src/math.ts", status: "modified", additions: 3, deletions: 1, patch: "" }],
})
const [count, setCount] = createSignal(1)
const [busy, setBusy] = createSignal(false)
const events = { redo: 0, redoAll: 0, reverted: [] as string[] }

const answeredRow: TranscriptRow = {
  type: "user",
  key: "msg_0:user",
  turn: "msg_0",
  userTurn: "msg_0",
  answered: true,
  message: { id: "msg_0", type: "user", text: "Earlier turn", time: { created: 1000 } },
}

const pendingTurnRow: TranscriptRow = {
  type: "user",
  key: "msg_live:user",
  turn: "msg_live",
  userTurn: "msg_live",
  answered: false,
  message: { id: "msg_live", type: "user", text: "Unanswered turn", time: { created: 2000 } },
}

const dispose = render(
  () => (
    <VSCodeProvider>
      <I18nProvider value={{ locale: () => "en", t }}>
        <ClipboardProvider>
          <DialogProvider>
            <LanguageContext.Provider value={language}>
              <div id="answered">
                <TranscriptRowView
                  row={answeredRow}
                  session="ses_1"
                  onRevertMessage={(_sid, mid) => events.reverted.push(mid)}
                  revertDisabled={busy()}
                />
              </div>
              <div id="unanswered">
                <TranscriptRowView
                  row={pendingTurnRow}
                  session="ses_1"
                  onRevertMessage={(_sid, mid) => events.reverted.push(mid)}
                  revertDisabled={busy()}
                />
              </div>
              <RevertBanner
                revert={revert()}
                count={count()}
                busy={busy()}
                onRedo={() => events.redo++}
                onRedoAll={() => events.redoAll++}
              />
            </LanguageContext.Provider>
          </DialogProvider>
        </ClipboardProvider>
      </I18nProvider>
    </VSCodeProvider>
  ),
  host,
)

try {
  // Answered row keeps revert action available even while the session already has a revert banner.
  const answeredBtn = host.querySelector<HTMLButtonElement>('#answered [data-slot="user-message-revert"]')
  assert.ok(answeredBtn, "answered user message renders revert button")
  assert.equal(answeredBtn.disabled, false)
  assert.equal(host.querySelector('#unanswered [data-slot="user-message-revert"]'), null)

  answeredBtn.click()
  assert.deepEqual(events.reverted, ["msg_0"])

  // Busy state marks the turn row and disables revert without removing the button.
  setBusy(true)
  assert.equal(answeredBtn.disabled, true)
  const userTurn = host.querySelector<HTMLElement>("#answered .vscode-session-turn-user")
  assert.equal(userTurn?.hasAttribute("data-revert-disabled"), true)
  assert.equal(userTurn?.getAttribute("title"), appEn["revert.disabled.agentBusy"])
  setBusy(false)

  // Count = 1 shows Redo only, file diff row, and no warning notice when workspace === "restored".
  assert.ok(host.textContent?.includes("1 message reverted"))
  assert.ok(host.textContent?.includes("src/math.ts"))
  assert.equal(host.querySelectorAll(".revert-banner-actions button").length, 1)
  assert.equal(host.querySelector(".revert-banner-notice"), null)

  // Count = 2 reveals Redo All.
  setCount(2)
  assert.ok(host.textContent?.includes("2 messages reverted"))
  const bannerBtns = host.querySelectorAll<HTMLButtonElement>(".revert-banner-actions button")
  assert.equal(bannerBtns.length, 2)
  bannerBtns[0]!.click()
  bannerBtns[1]!.click()
  assert.equal(events.redo, 1)
  assert.equal(events.redoAll, 1)

  // Explicit conversation-only outcomes and Checkpoints settings link.
  setRevert({ messageID: "msg_1", workspace: "snapshots-disabled" })
  assert.ok(host.textContent?.includes(appEn["revert.banner.workspace.snapshotsDisabled"]))
  const enableBtn = host.querySelector<HTMLButtonElement>(".revert-banner-notice button")
  assert.ok(enableBtn, "snapshots-disabled renders Enable snapshots button")
  posted.length = 0
  enableBtn.click()
  assert.deepEqual(posted, [{ type: "openSettingsTab", tab: "checkpoints" }])

  setRevert({ messageID: "msg_1", workspace: "not-a-git-repo" })
  assert.ok(host.textContent?.includes(appEn["revert.banner.workspace.notAGitRepo"]))

  setRevert({ messageID: "msg_1", workspace: "unavailable" })
  assert.ok(host.textContent?.includes(appEn["revert.banner.workspace.unavailable"]))

  // Legacy revert without explicit workspace field.
  setRevert({ messageID: "msg_1" })
  assert.ok(host.textContent?.includes(appEn["revert.banner.workspace.legacy"]))
} finally {
  dispose()
}
