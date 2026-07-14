/**
 * Source contract tests for prompt send paths.
 *
 * Static analysis — reads session.tsx source and verifies that sendMessage and
 * sendCommand still dismiss suggestions and reject questions before dispatching.
 * Also reads ChatView.tsx and asserts the prompt-block predicate is fed only
 * permission counts, never question counts — guarantees that a pending question
 * cannot re-block the prompt input.
 *
 * Protects against accidental removal during Kilo development.
 */

import { describe, it, expect } from "bun:test"
import fs from "node:fs"
import path from "node:path"
import { clearIfOn } from "../../webview-ui/src/context/session-cloud-prune"

const ROOT = path.resolve(import.meta.dir, "../..")
const SESSION_FILE = path.join(ROOT, "webview-ui/src/context/session.tsx")
const CHATVIEW_FILE = path.join(ROOT, "webview-ui/src/components/chat/ChatView.tsx")
const PROMPT_UTILS_FILE = path.join(ROOT, "webview-ui/src/components/chat/prompt-input-utils.ts")
const PROMPT_FILE = path.join(ROOT, "webview-ui/src/components/chat/PromptInput.tsx")
const KILOPROVIDER_FILE = path.join(ROOT, "src/KiloProvider.ts")
const CONNECTION_SERVICE_FILE = path.join(ROOT, "src/services/cli-backend/connection-service.ts")

function readFile(filePath: string): string {
  return fs.readFileSync(filePath, "utf-8")
}

/**
 * Extract the body of a named function from the source.
 * Finds `function <name>(` and returns everything from there to the next
 * `function ` declaration at the same or lower indentation, or to end of file.
 */
function extractFunctionBody(source: string, name: string): string {
  const marker = `function ${name}(`
  const start = source.indexOf(marker)
  if (start === -1) return ""

  // Find the next `function ` declaration after the opening one.
  // We search for a newline followed by `  function ` (2-space indent, matching
  // the indentation level of sendMessage/sendCommand inside SessionProvider).
  const rest = source.slice(start + marker.length)
  const next = rest.search(/\n  function /)
  return next === -1 ? rest : rest.slice(0, next)
}

describe("sendMessage dismisses pending tool requests", () => {
  const source = readFile(SESSION_FILE)
  const body = extractFunctionBody(source, "sendMessage")

  it("function sendMessage exists in session.tsx", () => {
    expect(body.length).toBeGreaterThan(0)
  })

  it("dismisses suggestions before sending", () => {
    expect(body).toContain("dismissSuggestion")
  })

  it("rejects questions before sending", () => {
    expect(body).toContain("dismissQuestion")
  })
})

describe("sendCommand dismisses pending tool requests", () => {
  const source = readFile(SESSION_FILE)
  const body = extractFunctionBody(source, "sendCommand")

  it("function sendCommand exists in session.tsx", () => {
    expect(body.length).toBeGreaterThan(0)
  })

  it("dismisses suggestions before sending", () => {
    expect(body).toContain("dismissSuggestion")
  })

  it("rejects questions before sending", () => {
    expect(body).toContain("dismissQuestion")
  })
})

describe("ChatView prompt-block contract", () => {
  const source = readFile(CHATVIEW_FILE)

  it("calls isPromptBlocked with exactly one argument (familyPermissions length)", () => {
    // Exact call shape — prettier formatting is deterministic here, so a strict
    // match catches both "someone added a second arg" and "someone wrapped it in
    // a different expression".
    expect(source).toMatch(/blocked\s*=\s*\(\)\s*=>\s*isPromptBlocked\(familyPermissions\(\)\.length\)/)
  })

  it("does not pass any second argument to isPromptBlocked", () => {
    expect(source).not.toMatch(/isPromptBlocked\s*\([^,)]*,[^)]*\)/)
  })

  it("does not define a blockingQuestions memo", () => {
    expect(source).not.toContain("blockingQuestions")
  })

  it("does not reference q.blocking when building the blocked state", () => {
    expect(source).not.toMatch(/q\.blocking/)
  })
})

describe("isPromptBlocked signature contract", () => {
  const source = readFile(PROMPT_UTILS_FILE)

  it("declares exactly one parameter (source-level guard)", () => {
    // Complements the runtime `isPromptBlocked.length === 1` check in
    // prompt-input-utils.test.ts. `Function.prototype.length` counts parameters
    // before the first default — this regex catches a future regression that
    // sneaks in a second param with a default value (which would otherwise keep
    // `.length === 1` and slip past the runtime check).
    const match = source.match(/export function isPromptBlocked\(([^)]*)\)/)
    expect(match).not.toBeNull()
    const params = match![1]
      .split(",")
      .map((p) => p.trim())
      .filter((p) => p.length > 0)
    expect(params).toHaveLength(1)
  })
})

describe("handleSessionDeleted draft cleanup contract", () => {
  const source = readFile(SESSION_FILE)

  it("clears draftSessionID independently of currentSessionID when it equals the deleted id", () => {
    const body = extractFunctionBody(source, "handleSessionDeleted")
    const draftBlock = body.match(/if \(draftSessionID\(\) === sessionID\) \{([\s\S]*?)\}/)
    expect(draftBlock).not.toBeNull()
    expect(draftBlock![1]).toContain("setDraftSessionID(undefined)")
    // Must be a sibling check, not nested inside the currentSessionID branch —
    // otherwise a deleted but non-active session leaves draftSessionID stale.
    const activeBlock = body.match(/if \(currentSessionID\(\) === sessionID\) \{([\s\S]*?)\}/)
    expect(activeBlock![1]).not.toContain("setDraftSessionID")
  })

  it("calls deleteDraftsForSession outside the cleanup batch so PromptInput's recreate is also cleaned up", () => {
    const body = extractFunctionBody(source, "handleSessionDeleted")
    const batchMatch = body.match(/batch\(\(\) => \{([\s\S]*?)\}\)/)
    expect(batchMatch).not.toBeNull()
    expect(batchMatch![1]).not.toContain("deleteDraftsForSession(sessionID)")
    const postBatch = body.slice((batchMatch!.index ?? 0) + batchMatch![0].length)
    expect(postBatch).toContain("deleteDraftsForSession(sessionID)")
  })

  it("removes the deleted id from the loaded Set so cascade/external deletes free the marker", () => {
    // The user-initiated deleteSession() path prunes loaded optimistically, but
    // cascade deletes and external CLI/TUI deletes only come through
    // handleSessionDeleted. Without this, those ids stay in loaded until reload.
    const body = extractFunctionBody(source, "handleSessionDeleted")
    expect(body).toMatch(
      /setLoaded\(\s*\(prev\)\s*=>\s*\{[\s\S]*?prev\.has\(sessionID\)[\s\S]*?next\.delete\(sessionID\)[\s\S]*?\}\)/,
    )
  })

  it("drops respondingPermissions entries that belong to the deleted session", () => {
    // setPermissions is cleared by removeSessionPermissions, but respondingPermissions
    // (the Set of in-flight permission ids) is a separate accessor that doesn't know
    // which ids belong to which session. Without an explicit prune here, a permission
    // request that the user was responding to when the session was deleted would keep
    // its id resident and block future requests with the same id.
    const body = extractFunctionBody(source, "handleSessionDeleted")
    expect(body).toContain("setRespondingPermissions")
  })
})

describe("KiloProvider pruneDeletedSession contract", () => {
  const source = readFile(KILOPROVIDER_FILE)

  it("drops sessionStatusMap entries alongside the other per-session caches", () => {
    // sessionStatusMap is the source of truth for the destructive-config busy-session
    // warning (sessionStatusMap.size === 0 short-circuit, the allStatusMap fed to the
    // Settings panel). Without this prune, deleted sessions stay marked as
    // busy/retry/etc. until provider dispose, suppressing the "you have a busy session"
    // warning for the new current session.
    const match = source.match(/pruneDeletedSession\(sessionID: string\): void \{([\s\S]*?)\n  \}/)
    expect(match).not.toBeNull()
    expect(match![1]).toContain("this.sessionStatusMap.delete(sessionID)")
  })

  it("clears currentSession and contextSessionID when the deleted id matches", () => {
    // The SSE session.deleted path runs pruneDeletedSession; if it leaves
    // currentSession pointing at the deleted session, resolveSession() in the
    // next sendMessage falls back to currentSession.id and targets a session
    // the backend has already deleted. The user-initiated delete path
    // (handleDeleteSession) does this clearing after the prune; pruneDeletedSession
    // itself must do the same so the SSE path is symmetric.
    const match = source.match(/pruneDeletedSession\(sessionID: string\): void \{([\s\S]*?)\n  \}/)
    expect(match).not.toBeNull()
    expect(match![1]).toMatch(
      /if \(this\.currentSession\?\.id === sessionID\)\s*\{[\s\S]*?this\.contextSessionID = undefined[\s\S]*?this\.setCurrentSession\(null\)/,
    )
  })

  it("unfocuses the streams when the deleted id matches the focused session", () => {
    // Without this, connectionService still reports the deleted id to the
    // backend as visible, and focusSession() never clears the visible
    // registration for this instance.
    const match = source.match(/pruneDeletedSession\(sessionID: string\): void \{([\s\S]*?)\n  \}/)
    expect(match).not.toBeNull()
    expect(match![1]).toMatch(/if \(this\.streams\.focused === sessionID\) this\.focusSession\(undefined\)/)
  })
})

describe("sendMessage / sendCommand draft id contract", () => {
  const source = readFile(SESSION_FILE)

  it("sendMessage mints a draftID when there is no current session and none was supplied", () => {
    // External session deletions leave currentSessionID() undefined and clear
    // draftSessionID(). Without minting a draftID here, the webview posts
    // {type: "sendMessage", sessionID: undefined, draftID: undefined} and the
    // extension's sessionCreated echo has no key to migrate the in-flight draft
    // from ":pending:<id>" to ":session:<newSessionId>". The user loses the
    // typed message and the new session starts empty.
    const body = extractFunctionBody(source, "sendMessage")
    expect(body).toMatch(/const effectiveDraftID = !sid && !draftID \? crypto\.randomUUID\(\) : draftID/)
  })

  it("sendCommand mints a draftID when there is no current session and none was supplied", () => {
    const body = extractFunctionBody(source, "sendCommand")
    expect(body).toMatch(/const effectiveDraftID = !sid && !draftID \? crypto\.randomUUID\(\) : draftID/)
  })

  it("sendMessage seeds the pending agent before resolving the draft-scoped agent", () => {
    // Fresh draft IDs are created after ModeSwitcher stored the selected mode in
    // pendingAgentSelection(). The draft scope must inherit that pending agent
    // before promptAgent(scope) runs, otherwise the first send pairs the selected
    // model with the default agent's system prompt.
    const body = extractFunctionBody(source, "sendMessage")
    expect(body).toMatch(
      /if \(!sid && !draftID && effectiveDraftID\) agentDrafts\.seed\(effectiveDraftID\)[\s\S]*const agent = promptAgent\(scope\)/,
    )
  })

  it("sendCommand seeds the pending agent before resolving the draft-scoped agent", () => {
    const body = extractFunctionBody(source, "sendCommand")
    expect(body).toMatch(
      /if \(!sid && !draftID && effectiveDraftID\) agentDrafts\.seed\(effectiveDraftID\)[\s\S]*const agent = promptAgent\(scope\)/,
    )
  })

  it("does not clear a newer pending agent when a seeded draft is promoted", () => {
    const body = extractFunctionBody(source, "handleSessionCreated")
    const draftBlock = body.match(/if \(draftID\) \{([\s\S]*?)\} else if/)
    expect(draftBlock).not.toBeNull()
    expect(draftBlock![1]).not.toContain("setPendingAgentSelection(null)")
  })

  it("only selects a created session when its explicit draft is still active", () => {
    const body = extractFunctionBody(source, "handleSessionCreated")
    expect(body).toMatch(/if \(draftID && \(draft === draftID \|\| active === draftID\)\)/)
    expect(body).not.toMatch(/if \(!draftID \|\|/)
  })

  it("prunes seeded draft agents only after the draft is abandoned", () => {
    const failed = extractFunctionBody(source, "handleSendMessageFailed")
    expect(source).toMatch(/const agentDrafts = createDraftAgentSeed/)
    expect(source).toContain("active: (draft) => !!submissionMap[draft]")
    expect(failed).toContain("draftSessionID() !== message.draftID")
    expect(failed).toContain("agentDrafts.prune(message.draftID)")
    expect(failed).not.toContain("setDraftSessionID(message.draftID)")
  })
})

describe("PromptInput restoreFailed fallback contract", () => {
  const source = readFile(PROMPT_FILE)

  it("stores a failed payload under its originating session or pending draft key", () => {
    const match = source.match(/const restoreFailed = \(failed: SendMessageFailedMessage\) => \{([\s\S]*?)\n  \}/)
    expect(match).not.toBeNull()
    expect(match![1]).toMatch(
      /failed\.sessionID\s*\? scopeDraftKey\(boxKey\(\), sessionDraftKey\(failed\.sessionID\)\)/,
    )
    expect(match![1]).toMatch(/failed\.draftID\s*\? scopeDraftKey\(boxKey\(\), pendingDraftKey\(failed\.draftID\)\)/)
    expect(match![1]).toContain("if (target !== draftKey())")
    expect(match![1]).toContain("saveDraft(target, draft, comments, images")
  })

  it("does not restore a late failure for a discarded pending tab", () => {
    const match = source.match(/const restoreFailed = \(failed: SendMessageFailedMessage\) => \{([\s\S]*?)\n  \}/)
    expect(match).not.toBeNull()
    expect(match![1]).toContain("isPendingDraftDiscarded(failed.draftID)")
    expect(match![1]).toContain("isSessionDraftDiscarded(failed.sessionID)")
  })

  it("retires a discarded real-session marker only after confirmed assistant output", () => {
    const session = readFile(SESSION_FILE)
    const created = extractFunctionBody(session, "handleMessageCreated")
    const status = extractFunctionBody(session, "handleSessionStatus")
    expect(created).toContain('message.role === "assistant"')
    expect(created).toContain("clearSessionDraftDiscarded(message.sessionID)")
    expect(status).not.toContain("clearSessionDraftDiscarded")
  })
})

describe("PromptInput send origin contract", () => {
  const source = readFile(PROMPT_FILE)

  it("captures the real or pending tab before asynchronous attachment resolution", () => {
    expect(source).toMatch(/const origin = session\.currentSessionID\(\)[\s\S]*const id = origin \?\? pendingId/)
    expect(source.indexOf("beginPendingSend(pendingId)")).toBeLessThan(
      source.indexOf("await terminal.resolveAttachment"),
    )
    expect(source).toMatch(/await terminal\.resolveAttachment\(message, id\)/)
    expect(source).toMatch(/await git\.resolveAttachment\(message, id, context\)/)
  })

  it("passes the captured origin to message and command sends", () => {
    expect(source).toMatch(/session\.sendMessage\([\s\S]*origin \?\? null\)/)
    expect(source).toMatch(/session\.sendCommand\([\s\S]*origin \?\? null\)/)
  })
})

describe("SessionContext userClearedSession contract", () => {
  const source = readFile(SESSION_FILE)

  it("declares userClearedSession on the context interface", () => {
    // restoreFailed uses session.userClearedSession() to decide whether :new
    // is a legitimate restore target after the user clicks New Task or
    // deletes their current/draft session. The accessor must be exposed.
    expect(source).toMatch(/userClearedSession:\s*Accessor<boolean>/)
  })

  it("clearCurrentSession sets the flag", () => {
    // User clicking New Task while a failure is pending must NOT restore
    // the failed draft into the new prompt.
    const body = extractFunctionBody(source, "clearCurrentSession")
    expect(body).toMatch(/setUserClearedSession\(true\)/)
  })

  it("deleteSession sets the flag when deleting the current or draft session", () => {
    // User clicking Delete on their current/draft session is morally the
    // same as New Task — both land in :new without wanting a stale restore.
    const body = extractFunctionBody(source, "deleteSession")
    expect(body).toMatch(
      /if \(id === currentSessionID\(\) \|\| id === draftSessionID\(\)\) setUserClearedSession\(true\)/,
    )
  })

  it("handleSessionCreated resets the flag when adopting the new session", () => {
    // After the user creates a new session, the flag is stale and must be
    // cleared so a later external delete of that new session can restore
    // into :new again.
    const body = extractFunctionBody(source, "handleSessionCreated")
    expect(body).toMatch(/setUserClearedSession\(false\)/)
  })

  it("selectSession resets the flag when picking an existing session", () => {
    const body = extractFunctionBody(source, "selectSession")
    expect(body).toMatch(/setUserClearedSession\(false\)/)
  })

  it("exposes userClearedSession in the SessionContext value", () => {
    expect(source).toMatch(/userClearedSession,?\s*\n\s*\}/m)
  })

  it("sendMessage resets userClearedSession when starting a fresh draft from :new", () => {
    // Race: user on session A, sends, failure pending; clicks New Task
    // (userClearedSession=true), then types new text and clicks Send. We mint
    // a draftID and adopt it as draftSessionID. If a failure for the new
    // send returns BEFORE sessionCreated lands (so currentSessionID is
    // still undefined and userClearedSession is still true), the failure's
    // draftID matches draftSessionID() but the flag would suppress restore.
    // Resetting the flag at the moment the user starts the new draft closes
    // that window: the failure is for the current in-progress draft and must
    // be restorable.
    const body = extractFunctionBody(source, "sendMessage")
    const block = body.match(/if \(!sid && \(!draftID \|\| draftSessionID\(\) === scope\)\) \{([\s\S]*?)\}/)
    expect(block).not.toBeNull()
    expect(block![1]).toMatch(/setUserClearedSession\(false\)/)
    expect(block![1]).toMatch(/setDraftSessionID\(scope\)/)
  })

  it("sendCommand resets userClearedSession when starting a fresh draft from :new", () => {
    const body = extractFunctionBody(source, "sendCommand")
    const block = body.match(/if \(!sid && \(!draftID \|\| draftSessionID\(\) === scope\)\) \{([\s\S]*?)\}/)
    expect(block).not.toBeNull()
    expect(block![1]).toMatch(/setUserClearedSession\(false\)/)
    expect(block![1]).toMatch(/setDraftSessionID\(scope\)/)
  })

  it("selectCloudSession resets userClearedSession when picking a cloud session", () => {
    // After clearCurrentSession set the flag, selecting a cloud session
    // must clear it (mirrors selectSession's reset). Without this, any
    // post-import failure exits restoration early and loses the cleared
    // text, review comments, and images.
    const body = extractFunctionBody(source, "selectCloudSession")
    expect(body).toMatch(/setUserClearedSession\(false\)/)
  })

  it("handleCloudSessionImported resets userClearedSession after the import completes", () => {
    // Defense in depth: even if selectCloudSession's reset was missed
    // (e.g. deleteSession set the flag against the synthetic cloud key
    // between select and import), the import confirmation must clear the
    // flag so a later post-import send failure is not suppressed.
    const body = extractFunctionBody(source, "handleCloudSessionImported")
    expect(body).toMatch(/setUserClearedSession\(false\)/)
  })

  it("handleCloudSessionImported migrates draftSessionID from the cloud key to the real session id", () => {
    // Without this, draftSessionID stays on the synthetic "cloud:<id>" key.
    // After a later external delete of the imported session,
    // handleSessionDeleted only clears draftSessionID when it equals the
    // deleted id; the synthetic cloud key never matches, so draftKey()
    // falls back to ":pending:cloud:<id>" and restoreFailed can no longer
    // match :session:<id> or :new — silently losing the failed draft.
    const body = extractFunctionBody(source, "handleCloudSessionImported")
    expect(body).toMatch(/setDraftSessionID\(session\.id\)/)
  })
})

describe("Cloud import parts cleanup contract", () => {
  const source = readFile(SESSION_FILE)

  it("declares a pendingCloudPrune tracker for cloud message IDs", () => {
    // Without a tracker, repeated preview -> import cycles accumulate full
    // cloud transcripts in store.parts because handleMessagesLoaded never
    // knows which keys belong to the carried-over cloud messages.
    expect(source).toMatch(/pendingCloudPrune/)
  })

  it("handleCloudSessionDataLoaded registers the cloud message IDs", () => {
    const body = extractFunctionBody(source, "handleCloudSessionDataLoaded")
    expect(body).toMatch(/pendingCloudPrune\.set\(/)
  })

  it("handleCloudSessionImported transfers the prune set to the new session id", () => {
    const body = extractFunctionBody(source, "handleCloudSessionImported")
    expect(body).toMatch(/pendingCloudPrune\.set\(session\.id,/)
    expect(body).toMatch(/pendingCloudPrune\.delete\(cloudKey\)/)
  })

  it("selecting a local session clears cloud preview mode", () => {
    const body = extractFunctionBody(source, "selectSession")
    expect(body).toContain("setCloudPreviewId(null)")
  })

  it("a late cloud import only selects its real session while the same preview remains active", () => {
    const body = extractFunctionBody(source, "handleCloudSessionImported")
    expect(body).toMatch(/const active = cloudPreviewId\(\) === cloudSessionId && currentSessionID\(\) === cloudKey/)
    expect(body).toMatch(/if \(active\) \{[\s\S]*setCurrentSessionID\(session\.id\)/)
  })

  it("handleMessagesLoaded prunes cloud-import orphans from store.parts and stash", () => {
    // The carried-over cloud messages are gone from store.messages after
    // this call, so any store.parts[<cloud-msg-id>] entry is unreachable.
    const body = extractFunctionBody(source, "handleMessagesLoaded")
    expect(body).toMatch(/pendingCloudPrune\.get\(sessionID\)/)
    expect(body).toMatch(/pendingCloudPrune\.delete\(sessionID\)/)
  })

  it("handleSessionDeleted prunes cloud-import orphans if the imported session is deleted before loadMessages returns", () => {
    const body = extractFunctionBody(source, "handleSessionDeleted")
    expect(body).toMatch(/pruneCloudOrphans\(sessionID\)/)
  })

  it("handleCloudSessionImportFailed prunes cloud parts and the synthetic session entries", () => {
    // Implemented as a switch case inside handleExtensionMessage, not a
    // standalone function, so search the source for the case body directly.
    const idx = source.indexOf('case "cloudSessionImportFailed"')
    expect(idx).toBeGreaterThan(-1)
    const after = source.slice(idx, idx + 4000)
    expect(after).toMatch(/pruneCloudOrphans\(failedKey\)/)
    expect(after).toMatch(/delete sessions\[failedKey\]/)
    expect(after).toMatch(/delete messages\[failedKey\]/)
  })

  it("handleCloudSessionImportFailed clears cloudPreviewId, currentSessionID, draftSessionID, and loading only when still on the failed cloud session", () => {
    // The failure arrives asynchronously. selectCloudSession sets the
    // preview id to the RAW cloud session id, both session/draft ids to
    // the synthetic "cloud:<id>" key, and the loading spinner, but the
    // user can start previewing a different cloud session, switch
    // sessions, or start a new task before the failure comes back.
    // Unconditionally resetting any of them would clobber that newer
    // scope: cloudPreviewId blanking drops a later preview response and
    // disables import-mode sends; currentSessionID blanking blanks
    // the active session; draftSessionID blanking leaves draftKey()
    // at ":new"; and unguarded setLoading(false) drops the spinner
    // for a newer preview before its data arrives, leaving the UI
    // looking idle while still loading. Clear only if still on the
    // dead preview's scope: cloudPreviewId is compared against the raw
    // message.cloudSessionId, while currentSessionID/draftSessionID are
    // compared against the "cloud:<id>" failedKey. The guard is
    // extracted into a clearIfOn helper to keep the switch-case
    // complexity under the lint cap.
    //
    // The loading check MUST run before cloudPreviewId is nulled,
    // otherwise `cloudPreviewId() === message.cloudSessionId` would be
    // false even on the failing preview and the spinner would stick
    // until later navigation clears it.
    const idx = source.indexOf('case "cloudSessionImportFailed"')
    expect(idx).toBeGreaterThan(-1)
    const after = source.slice(idx, idx + 4000)
    expect(after).toMatch(/clearIfOn\(cloudPreviewId, \(\) => setLoading\(false\), message\.cloudSessionId\)/)
    expect(after).toMatch(/clearIfOn\(cloudPreviewId, \(\) => setCloudPreviewId\(null\), message\.cloudSessionId\)/)
    expect(after).toMatch(/clearIfOn\(currentSessionID, \(\) => setCurrentSessionID\(undefined\), failedKey\)/)
    expect(after).toMatch(/clearIfOn\(draftSessionID, \(\) => setDraftSessionID\(undefined\), failedKey\)/)
    expect(after).not.toMatch(/^\s*setLoading\(false\)\s*$/m)
    // Loading check must come before cloudPreviewId null in the case body.
    const loadIdx = after.indexOf("setLoading(false)")
    const nullIdx = after.indexOf("setCloudPreviewId(null)")
    expect(loadIdx).toBeGreaterThan(-1)
    expect(nullIdx).toBeGreaterThan(-1)
    expect(loadIdx).toBeLessThan(nullIdx)
  })

  it("clearIfOn runs the clear callback only while the scope still matches the key", () => {
    // Used by cloudSessionImportFailed so the switch case stays under the
    // complexity cap. The helper must compare get() to the key before
    // calling the clear callback: a stale async failure must not clobber
    // a newer scope the user has navigated to. Takes a clear callback
    // rather than a setter so the same helper works for both
    // undefined-cleared signals (currentSessionID / draftSessionID) and
    // null-cleared signals (cloudPreviewId) without changing their setter
    // signatures.
    let cleared = 0
    let value = "pending"
    clearIfOn(
      () => value,
      () => {
        cleared++
      },
      "pending",
    )
    expect(cleared).toBe(1)

    // Scope has moved on (user navigated to a different preview / session)
    // — the clear callback must NOT run.
    value = "other"
    clearIfOn(
      () => value,
      () => {
        cleared++
      },
      "pending",
    )
    expect(cleared).toBe(1)
  })
})

describe("KiloConnectionService pruneSession contract", () => {
  const source = readFile(CONNECTION_SERVICE_FILE)

  it("drops the deleted session from attached and visible Maps", () => {
    // KiloProvider's pruneDeletedSession calls connectionService.pruneSession.
    // Without clearing attached/visible entries whose value is the deleted id,
    // the backend keeps receiving the dead session id and any background tab
    // opener stays registered for it.
    const match = source.match(/pruneSession\(sessionId: string\): void \{([\s\S]*?)\n  \}/)
    expect(match).not.toBeNull()
    expect(match![1]).toMatch(/this\.attached\.(?:set|delete)/)
    expect(match![1]).toMatch(/this\.visible\.(?:set|delete)/)
    expect(match![1]).toMatch(/this\.flushViewed\(\)/)
  })
})
