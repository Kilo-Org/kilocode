#!/usr/bin/env bun
// UX end-to-end runner for the Kilo browser bridge: every human-visible surface (the extension's "Local agents"
// settings, the pairing notices, the tab groups, the Alt+Shift+K command, the CLI TUI prompts) and the exact text the
// model receives for each error, against the real built Chrome MV3 extension and the real `kilo2` binary.
// Not a `bun test` file: it needs a display (run it under `xvfb-run -a -s "-screen 0 1920x1080x24"`; the window is a
// real 1280x900 one), a built CLI binary and the built extension.
//
//   bun test/browser/ux-e2e.ts <kilo2> <scenario>
//
//   E2E_EXTENSION_DIR   the built unpacked extension (default: ../../../cloud/apps/extension/.output/chrome-mv3)
//   E2E_CHROMIUM        the Chromium executable (default: playwright-core's own build)
//   E2E_HOME            the run's home (default: a fresh mkdtemp); every CLI run gets run-<n> under it
//   E2E_EVIDENCE        where screenshots and pane captures go (default: $E2E_HOME/evidence)
//   E2E_PORTS           an inclusive hub port range "<from>-<to>" (default: any free port)
//   E2E_EXPIRY_WAIT_MS  how long the expired-token case waits past issuing (default: 62000; the hub TTL is 60 s)
//   E2E_DOWNLOADS_GRANTED=0  load the shipped build (no optional permission accepted)
//   E2E_NATIVE_GRANTED=0     accept only `downloads`, not `nativeMessaging`
//
// Scenarios:
//   pairing   settings empty states, the paired CLI reconnecting and unreachable, and the pairing notices (expired,
//             invalid incl. a broken link, not_allowed, unreachable)
//   controls  Stop all, the switch turned off mid-run, per-controller Disconnect and the Alt+Shift+K command, each
//             against a live run: tab group before/after, the settings list, and the next call's model text
//   errors    the verbatim model-visible text of every reachable error code
//   tui       the TUI in tmux: browser permission prompt (allow once, always, reject), the sensitive step, the
//             unavailable hint and the stopped session
//   tui-redirect  a redirect to an ungranted origin in the TUI: one prompt, then the navigate lands there
//   settings-faults  the settings page's load/save/command error lines (Stop all and Disconnect worded for
//             themselves), with storage and messaging faults injected
//   share-adopt  `/browser share` (own session, a tab another session holds) and `/browser adopt` (an ended group,
//             nothing ended, typed before the TUI's server loaded its plugins) in TUI sessions that share one hub
//   signed-out  the local-agent switch and a run while signed out of Kilo, then sign-out and token expiry mid-run:
//             which storage keys survive (the local-agent ones must, the account token must not)
//   stop-race  Stop all while a second conversation of the same `kilo2 serve` is mid-turn: its call must not open a
//             new group, and its next turn works
//   all       pairing, controls, errors, tui and settings-faults in one browser
//
// Each scenario prints one JSON report and exits non-zero when a hard expectation fails. Findings that are UX judgments
// rather than broken contracts go to `observations`, not `failures`.
//
// Known failures: KNOWN_FAILURES lists whole scenarios and single checks (`<scenario>:<check>`) that fail today for a
// reason owned elsewhere. Their misses go to `knownChecks` (or, for a whole scenario, its failures) and the run
// reports `status: "known-fail"` and exits 0; when every known check passes the status is `UNEXPECTED PASS`, so the
// entry can go. `--strict` makes a known failure exit non-zero. Any other failure is `FAIL` and exits 1.
//
// The Chromium launch (a real profile, no DevTools download override), the API routes, the hub, pairing, the
// scripted model and the CLI runs come from extension-harness.ts.
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {
  acceptPermissionPrompts,
  acceptPermissionsCopy,
  bridgeEnvironment,
  type Bridge,
  type Call,
  defaultExtensionDirectory,
  field,
  freshRoot as harnessFreshRoot,
  type GroupInfo,
  type Hub,
  html,
  launchChromium,
  type Launched,
  openPairing as harnessOpenPairing,
  pair as harnessPair,
  pairingUrl,
  type Page,
  type Plan,
  portPool,
  PUBLIC_MARKER,
  record,
  refOf,
  routeKiloApi,
  type Run,
  type RunOptions,
  runAgent,
  groupById,
  openUserTab,
  type Settings,
  startBridgeHub,
  startModel,
  tap,
  terminate,
  tabState as harnessTabState,
  type TabInfo,
  until,
  type Worker,
} from "./extension-harness"

const binaryInput = process.argv[2]
const scenario = process.argv[3] ?? "all"
if (!binaryInput) throw new Error("usage: bun test/browser/ux-e2e.ts <kilo2> <scenario>")
const binary = path.resolve(binaryInput)

const extensionDirectory = defaultExtensionDirectory
const EXPIRY_WAIT_MS = Number(process.env.E2E_EXPIRY_WAIT_MS ?? "62000")

const PASSWORD_VALUE = "hunter2"

declare const chrome: {
  storage: {
    local: { get(key: string | null): Promise<unknown>; set(items: Record<string, unknown>): Promise<void> }
    session: { get(key: string | null): Promise<unknown> }
  }
  tabGroups: { get(groupId: number): Promise<unknown>; query(query: Record<string, unknown>): Promise<unknown> }
  tabs: {
    get(tabId: number): Promise<unknown>
    query(query: Record<string, unknown>): Promise<unknown>
    update(tabId: number, properties: Record<string, unknown>): Promise<{ windowId: number }>
  }
  windows: { update(windowId: number, properties: Record<string, unknown>): Promise<unknown> }
  commands: { getAll(): Promise<unknown> }
}

// ---------------------------------------------------------------------------------------------
// Fixtures: a localhost page (button, password field, a redirect to the public origin, a slow page) and a second
// origin on 127.0.0.2 the default rules do not cover.
// ---------------------------------------------------------------------------------------------

const recorded: string[] = []

const simple = `<!doctype html>
<html><head><meta charset="utf-8"><title>Browser E2E</title></head>
<body>
  <h1>Browser E2E</h1>
  <button id="go">Click me</button>
  <input id="pw" type="password" aria-label="Password" />
  <p id="status">idle</p>
  <a id="away" href="/redirect">Go away</a>
  <script>
    document.getElementById("go").addEventListener("click", () => {
      document.getElementById("status").textContent = "clicked"
    })
    const pw = document.getElementById("pw")
    const send = () => fetch("/__record", { method: "POST", body: pw.value })
    pw.addEventListener("input", send)
    pw.addEventListener("change", send)
  </script>
</body></html>`

const frame = Bun.serve({
  hostname: "127.0.0.2",
  port: 0,
  fetch() {
    return html(`<!doctype html><html><head><title>Public</title></head><body><h1 id="marker">${PUBLIC_MARKER}</h1></body></html>`)
  },
})
const publicOrigin = frame.url.origin

const fixture = Bun.serve({
  // `/slow` holds a response for 45 s; Bun's default 10 s idle timeout would cut it.
  idleTimeout: 0,
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    const url = new URL(request.url)
    if (url.pathname === "/__record") {
      recorded.push(await request.text().catch(() => ""))
      return new Response(null, { status: 204 })
    }
    if (url.pathname === "/redirect") return Response.redirect(`${publicOrigin}/public`, 302)
    if (url.pathname === "/slow") {
      await Bun.sleep(Number(url.searchParams.get("ms") ?? "45000"))
      return html("<!doctype html><title>Slow</title><h1>slow done</h1>")
    }
    return html(simple)
  },
})
const localOrigin = fixture.url.origin

// Scripted model: a plan returns one call, several parallel calls, or nothing; every tool message the CLI sends back
// is kept verbatim in `model.history` (that is the text the model reads), and `model.requests` counts every request.
const model = startModel({ label: "Browser UX E2E" })
/** The model's request log, cleared in place before each TUI run (runAgent clears it for CLI runs). */
const history = model.history

// ---------------------------------------------------------------------------------------------
// Chromium and the settings page.
// ---------------------------------------------------------------------------------------------

const failures: string[] = []
const observations: string[] = []
function expect(condition: boolean, message: string) {
  if (!condition) failures.push(message)
  return condition
}
function observe(condition: boolean, message: string) {
  if (!condition) observations.push(message)
  return condition
}

const PROMPTS_FIX = "kilocode #16390 (browser prompts name the class and origin, typed text masked)"
const SHARE_ADOPT_FIX = "kilocode #16392 (/browser share, /browser adopt and browser notices)"

/**
 * What fails today for a reason owned elsewhere: whole scenarios, with the failure messages they are expected to
 * produce, and single checks (`<scenario>:<check>`) inside scenarios that otherwise must pass. A failure that matches
 * none of a scenario's messages (a harness error, a TUI or serve that never starts, another regression) stays `FAIL`
 * (see `finish`). A check entry with `failures` is held to them too: a miss with any other message is a plain failure.
 * A known scenario or check that passes is reported as an unexpected pass, so its entry can go.
 */
const KNOWN_FAILURES: Record<string, { reason: string; failures?: RegExp[] }> = {
  "share-adopt": {
    reason: SHARE_ADOPT_FIX,
    failures: [
      /^share: no "Your active tab is now in this session's tab group\." toast/,
      /^share: the user tab is not in A's group/,
      /^held: no "The active tab belongs to another agent session…" toast/,
      /^adopt: no "This session now uses the last ended tab group\." toast/,
      /^adopt: A's group is not back to/,
      /^adopt: C's snapshot did not read the adopted tab/,
      /^adopt with nothing ended: no "There is no ended tab group to reuse\." toast/,
      /^a "\/browser adopt" typed right after the TUI drew answered neither/,
    ],
  },
  "tui-redirect": {
    reason: "cloud #11921 + kilocode #16382",
    failures: [/^redirect: expected one permission prompt/, /^redirect: the navigate did not land/],
  },
  "tui:prompt-text": {
    reason: PROMPTS_FIX,
    failures: [
      /^(once|always|reject): the navigate prompt does not read "Open pages on \S+" with "Approving lets this conversation open pages on \S+ until it ends\."$/,
      /^(once|always|reject): a browser prompt still reads "Call tool browser"$/,
      /^(once|always): no prompt reads "Read pages on \S+" with "Approving lets this conversation read pages on \S+ until it ends\." for the snapshot$/,
      /^(ask|allow-all): the sensitive prompt does not read "Sensitive browser step on \S+" with a "Reason: …" line$/,
    ],
  },
  "tui:masked-text": {
    reason: PROMPTS_FIX,
    failures: [
      /^(ask|allow-all): the pane shows the typed password: › browser\.type \[element=the password field, target=\w+, text=hunter2\]/,
    ],
  },
  "tui:notices": {
    reason: SHARE_ADOPT_FIX,
    failures: [
      /^(ask|allow-all): no "You stopped the browser for this session…" toast after Stop all; toasts: \[(?!.*stopped).*\]$/,
      /^the TUI shows no "Browser not available" toast with the unpaired install hint; toasts: \[(?!.*Browser not available).*\]$/,
    ],
  },
}
/** The known checks this run evaluated: their outcome and, when they failed, the message. */
const knownChecks: { check: string; message?: string; passed: boolean; reason: string }[] = []

/**
 * A hard check that is a known failure today: a miss is recorded against its reason instead of failing the run, as
 * long as its message is one the entry expects (when the entry lists any).
 */
function expectKnown(check: string, condition: boolean, message: string) {
  const known = KNOWN_FAILURES[check]
  if (known === undefined) return expect(condition, message)
  if (!condition && known.failures && !known.failures.some((pattern) => pattern.test(message)))
    return expect(false, `${check} (known for ${known.reason}) failed with an unexpected message: ${message}`)
  knownChecks.push({ check, passed: condition, reason: known.reason, ...(condition ? {} : { message }) })
  return condition
}

/** The same check as `until`, but a miss is a value instead of a throw. */
async function maybe<T>(check: () => Promise<T | undefined> | T | undefined, timeout: number): Promise<T | undefined> {
  return until(check, timeout).catch(() => undefined)
}

/** A port in the assigned range (cycling), or any free one when no range is set. */
const freePort = portPool(process.env.E2E_PORTS)

let launched: Launched | undefined
let bridge!: Bridge
let extensionId = ""
let panel: Page
let worker: Worker
let base = ""
let evidence = ""
const shots: string[] = []

/**
 * The extension this run loads. By default a copy with the optional `downloads` permission promoted to required: the
 * state after the user accepts the switch's permission prompt, which automation cannot answer. Without it every
 * navigation is refused (see the "downloads-ungranted" evidence). `E2E_DOWNLOADS_GRANTED=0` loads the shipped build;
 * `E2E_NATIVE_GRANTED=0` accepts `downloads` only.
 */
let loadedExtension = extensionDirectory

async function launch() {
  await fs.access(path.join(extensionDirectory, "manifest.json"))
  if (process.env.E2E_DOWNLOADS_GRANTED !== "0") {
    // Both optional permissions the switch requests: the state after the user accepts its prompt.
    const accepted = ["downloads", ...(process.env.E2E_NATIVE_GRANTED === "0" ? [] : ["nativeMessaging"])]
    loadedExtension = await acceptPermissionsCopy(extensionDirectory, path.join(base, "extension-accepted"), accepted)
  }
  launched = await launchChromium({ args: ["--window-position=0,0"], extension: loadedExtension, profile: path.join(base, "profile") })
  worker = launched.worker
  extensionId = launched.extensionId
  bridge = { base, binary, browser: launched, model, nextPort: freePort, pair }
}

/** What the routed `/api/user` answers: 200 signs the page in, 401 expires the token, 500 is a validation error. */
let apiUserStatus = 200

/**
 * The settings page signed in, the way the existing e2e does it (auth and org fetches answered locally, for both the
 * production API base and a development build's http://localhost:3000).
 */
async function openPanel(seed = true) {
  const context = launched!.context
  await routeKiloApi(context, () => apiUserStatus)
  await acceptPermissionPrompts(context)
  panel = await context.newPage()
  panel.setDefaultTimeout(20_000)
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`)
  if (seed) await signIn()
}

/** The signed-in state a completed device sign-in leaves: the stored token, then a reload that validates it. */
async function signIn() {
  await panel.evaluate(async () => {
    const api = (globalThis as unknown as { chrome: typeof chrome }).chrome
    await api.storage.local.set({ kiloAuth: { token: "token-1", userEmail: "e2e@kilo.ai" } })
  })
  await panel.reload()
  await openSettings()
}

async function openSettings() {
  const section = panel.locator('section[aria-label="Local agents"]')
  if ((await section.count()) > 0) return
  const settings = panel.getByRole("button", { name: "Settings" })
  await settings.waitFor().catch(async (error: unknown) => {
    const file = path.join(evidence, `${scenarioLabel}-no-settings-button.png`)
    await fs.mkdir(evidence, { recursive: true })
    await panel.screenshot({ path: file, fullPage: true }).catch(() => undefined)
    const body = await panel.locator("body").innerText().catch(() => "")
    throw new Error(`no Settings button on ${panel.url()} (screenshot ${file}); page text: ${body.slice(0, 600)}; ${String(error)}`)
  })
  await settings.click()
  await section.waitFor()
}

const toggle = () => panel.getByRole("switch", { name: "Allow local agents" })

async function switchState() {
  return (await toggle().getAttribute("aria-checked")) === "true"
}

async function setSwitch(on: boolean) {
  await openSettings()
  const control = toggle()
  await control.waitFor()
  if ((await switchState()) !== on) await control.click()
  await until(async () => ((await switchState()) === on ? true : undefined), 10_000, `the switch turns ${on ? "on" : "off"}`)
  await until(async () => {
    const stored = record(field(await worker.evaluate(() => chrome.storage.local.get("kiloLocalAgentSettings")), "kiloLocalAgentSettings"))
    return stored?.["enabled"] === on ? true : undefined
  }, 10_000, "the switch persists")
}

/** The "Local agents" section as the user reads it. */
async function sectionText() {
  await openSettings()
  return (await panel.locator('section[aria-label="Local agents"]').innerText()).replace(/\n+/g, " | ")
}

async function sessionStorage() {
  const all = record(await worker.evaluate(() => chrome.storage.session.get(null))) ?? {}
  return {
    controllers: field(all["kiloLocalAgentControllers"], "controllers") ?? null,
    // The pairing notice is stored as `{ notice }`.
    notice: field(all["kiloLocalAgentPairingNotice"], "notice") ?? null,
    status: field(all["kiloLocalAgentStatus"], "endpoints") ?? null,
  }
}

/** The settings section, the full page, and the whole xvfb screen (tab strip and tab groups included). */
async function shot(name: string) {
  await fs.mkdir(evidence, { recursive: true })
  const prefix = `${scenarioLabel}-${name}`
  try {
    await panel.bringToFront()
    await openSettings()
    const sectionPath = path.join(evidence, `${prefix}.section.png`)
    await panel.locator('section[aria-label="Local agents"]').screenshot({ path: sectionPath })
    shots.push(sectionPath)
  } catch (error) {
    observations.push(`screenshot ${prefix}.section failed: ${String(error)}`)
  }
  await screen(name)
}

async function screen(name: string) {
  await fs.mkdir(evidence, { recursive: true })
  const screenPath = path.join(evidence, `${scenarioLabel}-${name}.screen.png`)
  const child = Bun.spawn(["import", "-window", "root", screenPath], { stderr: "pipe", stdout: "ignore" })
  if ((await child.exited) === 0) shots.push(screenPath)
  else observations.push(`screen capture ${screenPath} failed: ${await new Response(child.stderr as ReadableStream).text()}`)
}

const tabState = () => harnessTabState(worker)

const liveGroup = (groups: GroupInfo[]) =>
  groups.find((group) => typeof group.title === "string" && group.title.startsWith("Kilo · ") && group.title !== "Kilo · ended")

// ---------------------------------------------------------------------------------------------
// Hub and CLI runs (extension-harness.ts), with this runner's labels and pairing diagnostics.
// ---------------------------------------------------------------------------------------------

const freshRoot = (label: string) => harnessFreshRoot(bridge, label)
const startHub = (root: string, settings: Settings) => startBridgeHub(bridge, root, settings)
const openPairing = (url: string) => harnessOpenPairing(launched!, url)

/** The environment a hub or run in `root` gets, without unset variables (the TUI launcher exports each one). */
function environment(root: string, settings: Settings): Record<string, string> {
  return Object.fromEntries(
    Object.entries(bridgeEnvironment(bridge, root, settings)).filter((entry): entry is [string, string] => entry[1] !== undefined),
  )
}

/** The harness's pairing step; a failure carries the extension's storage, tabs and the hub's state. */
async function pair(hub: Hub) {
  return harnessPair(hub, launched!).catch(async (error: unknown) => {
    const storage = await sessionStorage().catch((caught: unknown) => String(caught))
    const local = await worker.evaluate(() => chrome.storage.local.get(null)).catch((caught: unknown) => String(caught))
    const tabs = (await tabState().catch(() => ({ tabs: [] as TabInfo[] }))).tabs.map((tab) => tab.url?.replace(/#.*/, "#…"))
    throw new Error(
      `${String(error)}; switch=${await switchState().catch(() => "?")}; session=${JSON.stringify(storage).slice(0, 800)}; local keys=${Object.keys(record(local) ?? {}).join(",")}; endpoints=${JSON.stringify(field(local, "kiloLocalAgentEndpoints") ?? null).slice(0, 300)}; tabs=${JSON.stringify(tabs)}; hub=${JSON.stringify(await hub.entry())}; hubLog=${hub.log.text.slice(-800)}`,
    )
  })
}

function run(plan: Plan, settings: Settings, options: RunOptions = {}): Promise<Run> {
  return runAgent(bridge, plan, settings, { ...options, label: options.label ?? "run" })
}

const navigate = (url: string): Call => ({ args: { url }, name: "browser_navigate" })
const snapshot: Call = { args: {}, name: "browser_snapshot" }

/** The CLI's own tool events: the error string the run recorded for each tool part, when there is one. */
function toolEvents(stdout: string) {
  const events: { tool?: unknown; status?: unknown; error?: unknown; output?: unknown }[] = []
  for (const line of stdout.split("\n")) {
    if (!line.startsWith("{")) continue
    try {
      const event: unknown = JSON.parse(line)
      if (field(event, "type") !== "tool_use") continue
      const part = record(field(event, "part"))
      const state = record(part?.["state"])
      events.push({
        error: state?.["error"],
        output: typeof state?.["output"] === "string" ? (state["output"] as string).slice(0, 600) : state?.["output"],
        status: state?.["status"],
        tool: part?.["tool"],
      })
    } catch {
      // Not an event line.
    }
  }
  return events
}

/** Leaks the SPEC forbids in model text: transport states, JSON-RPC codes, hub internals. */
const TRANSPORT_WORDS =
  /websocket|loopback|native messaging|json-?rpc|-320\d\d|hub\b|controller|sessionHandle|socket|reconnect|handshake|transport|\(tab_busy\)|tab_busy|user_stopped|browser_unavailable|needs_permission|origin_changed/i

type Judgement = { length: number; transportLeak: string | null }

function judge(text: string): Judgement {
  const leak = TRANSPORT_WORDS.exec(text)?.[0]
  return { length: text.length, transportLeak: leak ?? null }
}

let scenarioLabel = scenario

// ---------------------------------------------------------------------------------------------
// Scenario: pairing and the settings empty states.
// ---------------------------------------------------------------------------------------------

/** A loopback server that answers the redeem request with a malformed 200 body: the extension's "invalid" case. */
function badRedeemServer(port: number) {
  return Bun.serve({
    hostname: "127.0.0.1",
    port,
    fetch(request) {
      const url = new URL(request.url)
      if (url.pathname === "/__kilo_browser_pair/key") return Response.json({ v: 2, key: "not-a-key" })
      return html("<!doctype html><title>Kilo pairing</title>")
    },
  })
}

function fragmentOf(url: string) {
  const parsed = new URL(url)
  return { origin: parsed.origin, path: parsed.pathname, params: new URLSearchParams(parsed.hash.slice(1)) }
}

function withFragment(url: string, change: (params: URLSearchParams) => void) {
  const { origin, path: pathname, params } = fragmentOf(url)
  change(params)
  return `${origin}${pathname}#${params.toString()}`
}

/**
 * The same 16-byte token with its first character changed, so the hub sees a well-formed but unknown token (404,
 * "expired"). The last character of a 22-character base64url token carries only 2 data bits: changing it to "B" made a
 * non-canonical encoding the hub refuses as malformed (400, "invalid") whenever the token happened to end in "A".
 */
function tamperToken(token: string) {
  const first = token.at(0) === "A" ? "B" : "A"
  return `${first}${token.slice(1)}`
}

async function noticeAfter(label: string, open: () => Promise<void>, timeout = 15_000) {
  // Each attempt clears the notice before it redeems, but a fast failure can land before the first poll; resetting
  // the stored value first keeps one case's notice from reading as the next case's.
  await worker.evaluate(() =>
    (globalThis as unknown as { chrome: { storage: { session: { set(items: Record<string, unknown>): Promise<void> } } } }).chrome.storage.session.set({
      kiloLocalAgentPairingNotice: { notice: null },
    }),
  )
  await open()
  const notice = await maybe(async () => {
    const current = (await sessionStorage()).notice
    return current === null ? undefined : current
  }, timeout)
  const text = await sectionText()
  await shot(label)
  return { notice: notice ?? null, section: text }
}

async function pairingScenario() {
  scenarioLabel = "pairing"
  const results: Record<string, unknown> = {}

  // Empty: the switch off. Nothing but the switch and its description.
  results["off"] = { section: await sectionText(), storage: await sessionStorage() }
  await shot("01-switch-off")

  // Empty: switch on, no CLI anywhere: the native host is not installed here and no loopback endpoint exists.
  await setSwitch(true)
  await Bun.sleep(2_500)
  results["on-no-cli"] = { section: await sectionText(), storage: await sessionStorage() }
  await shot("02-switch-on-no-cli")

  // Happy: pair with a live hub, nobody running: "No agents connected."
  const hubRoot = await freshRoot("pair-happy")
  const hub = await startHub(hubRoot, {})
  const started = Date.now()
  await pair(hub)
  const pairMs = Date.now() - started
  await maybe(async () => ((await sectionText()).includes("No agents connected") ? true : undefined), 10_000)
  results["happy"] = { pairMs, section: await sectionText(), storage: await sessionStorage(), tabs: (await tabState()).tabs.map((tab) => tab.url) }
  await shot("03-paired-idle")

  // Unhappy, retryable: the hub stops. The settings page names the paired CLI and says it is reconnecting.
  await hub.stop()
  const afterStop = await maybe(async () => {
    const text = await sectionText()
    return text.includes("Reconnecting") ? text : undefined
  }, 20_000)
  results["hub-stopped"] = { section: afterStop ?? (await sectionText()), storage: await sessionStorage() }
  expectKnown(
    "pairing:hub-reconnecting",
    afterStop !== undefined && afterStop.includes(`Kilo CLI · 127.0.0.1:${hub.port}`) && !afterStop.includes("Kilo CLI not found"),
    `20 s after the paired hub stopped the settings do not show it reconnecting: ${await sectionText()}`,
  )
  await shot("04-paired-hub-stopped")
  {
    // The stopped hub has been gone for longer than the reconnect grace: its row now says it cannot be reached.
    const later = await maybe(async () => {
      const text = await sectionText()
      return text.includes("Not reachable") ? text : undefined
    }, 70_000)
    results["hub-stopped-later"] = { section: later ?? (await sectionText()) }
    expectKnown(
      "pairing:hub-unreachable",
      later !== undefined && later.includes(`Kilo CLI · 127.0.0.1:${hub.port}`),
      `a hub gone for over a minute is not shown as unreachable: ${await sectionText()}`,
    )
    await shot("04b-paired-hub-unreachable")
  }

  // expired: a real token issued more than 60 s before the browser opens it.
  {
    const root = await freshRoot("pair-expired")
    const expiredHub = await startHub(root, {})
    const url = await pairingUrl(expiredHub)
    await Bun.sleep(EXPIRY_WAIT_MS)
    results["expired"] = { waitedMs: EXPIRY_WAIT_MS, ...(await noticeAfter("05-notice-expired", () => openPairing(url))) }
    expect(field(results["expired"], "notice") === "expired", `an expired token did not show "expired": ${JSON.stringify(results["expired"])}`)
    // Retry from the notice: a fresh pairing on the same hub clears it and connects.
    const retried = await pair(expiredHub).then(() => true, (error: unknown) => String(error))
    results["expired-retry"] = { paired: retried, section: await sectionText(), storage: await sessionStorage() }
    expect(retried === true && (await sessionStorage()).notice === null, `pairing again after "expired" did not recover: ${JSON.stringify(results["expired-retry"])}`)
    await shot("06-expired-then-paired")
    await expiredHub.stop()
  }

  // Tampered fragments: a changed token reaches the hub (unknown token); a broken hub id or ws URL is ignored.
  {
    const root = await freshRoot("pair-tampered")
    const tamperedHub = await startHub(root, {})
    const url = await pairingUrl(tamperedHub)
    const token = fragmentOf(url).params.get("t") ?? ""
    results["tampered-token"] = await noticeAfter("07-notice-tampered-token", () =>
      openPairing(withFragment(url, (params) => params.set("t", tamperToken(token)))),
    )
    const tabsBefore = (await tabState()).tabs.length
    const hubTampered = withFragment(url, (params) => params.set("hub", "not-a-uuid"))
    const silent = await noticeAfter("08-tampered-hub-id", () => openPairing(hubTampered), 5_000)
    const leftOpen = (await tabState()).tabs.filter((tab) => typeof tab.url === "string" && tab.url.includes("__kilo_browser_pair"))
    results["tampered-hub-id"] = { ...silent, pairingTabsLeftOpen: leftOpen.map((tab) => tab.url?.replace(/#.*/, "#…")), tabsBefore }
    expectKnown(
      "pairing:broken-link-notice",
      silent.notice === "invalid" && leftOpen.length === 0,
      `a pairing URL with a broken hub id did not show "invalid" and close its tab: ${JSON.stringify(results["tampered-hub-id"])}`,
    )
    for (const tab of leftOpen) {
      if (typeof tab.id === "number") await worker.evaluate(async (id: number) => (globalThis as unknown as { chrome: { tabs: { remove(id: number): Promise<void> } } }).chrome.tabs.remove(id), tab.id)
    }
    await tamperedHub.stop()
  }

  // not_allowed: a hub that does not list this (unpacked) extension's id.
  {
    const root = await freshRoot("pair-not-allowed")
    const strictHub = await startHub(root, { env: { KILO_BROWSER_EXTRA_EXTENSION_IDS: "" } })
    const url = await pairingUrl(strictHub)
    results["not-allowed"] = { ...(await noticeAfter("09-notice-not-allowed", () => openPairing(url))), hubLog: strictHub.log.text.slice(-600) }
    expect(field(results["not-allowed"], "notice") === "not_allowed", `a non-allowlisted origin did not show "not_allowed": ${JSON.stringify(results["not-allowed"])}`)
    await strictHub.stop()
  }

  // unreachable: a real URL whose hub stopped before the browser opened it.
  {
    const root = await freshRoot("pair-unreachable")
    const goneHub = await startHub(root, {})
    const url = await pairingUrl(goneHub)
    await goneHub.stop()
    results["unreachable"] = await noticeAfter("10-notice-unreachable", () => openPairing(url))
    expect(field(results["unreachable"], "notice") === "unreachable", `a stopped hub did not show "unreachable": ${JSON.stringify(results["unreachable"])}`)
  }

  // invalid: the loopback server answers the redeem with a malformed body.
  {
    const port = await freePort()
    const server = badRedeemServer(port)
    const url = `http://127.0.0.1:${port}/__kilo_browser_pair#hub=${crypto.randomUUID()}&t=${Buffer.alloc(16, 7).toString("base64url")}&v=1&ws=${encodeURIComponent(`ws://127.0.0.1:${port}/__kilo_browser`)}`
    results["invalid"] = await noticeAfter("11-notice-invalid", () => openPairing(url))
    expect(field(results["invalid"], "notice") === "invalid", `a malformed redeem answer did not show "invalid": ${JSON.stringify(results["invalid"])}`)
    server.stop(true)
  }

  // A notice and a later successful pairing: the notice clears.
  {
    const root = await freshRoot("pair-recover")
    const recoverHub = await startHub(root, {})
    await pair(recoverHub)
    results["recovered"] = { section: await sectionText(), storage: await sessionStorage() }
    expect((await sessionStorage()).notice === null, `a successful pairing left the old notice: ${JSON.stringify(results["recovered"])}`)
    await shot("12-recovered")
    await recoverHub.stop()
  }
  return results
}

// ---------------------------------------------------------------------------------------------
// Scenario: the session controls against a live run.
// ---------------------------------------------------------------------------------------------

/** Focus the Chromium window on the xvfb display and press the extension's Stop all command. */
async function pressHotkey() {
  const run = async (args: string[]) => {
    const child = Bun.spawn(["xdotool", ...args], { stderr: "pipe", stdout: "pipe" })
    const [out, err, code] = await Promise.all([
      new Response(child.stdout as ReadableStream).text(),
      new Response(child.stderr as ReadableStream).text(),
      child.exited,
    ])
    return { code, err: err.trim(), out: out.trim() }
  }
  const search = await run(["search", "--onlyvisible", "--class", "chromium"])
  const windows = search.out.split("\n").filter(Boolean)
  const target = windows.at(-1)
  if (target === undefined) return { error: `no Chromium window: ${JSON.stringify(search)}` }
  const focus = await run(["windowfocus", "--sync", target])
  const key = await run(["key", "--clearmodifiers", "--window", target, "alt+shift+k"])
  const keyFocused = await run(["key", "--clearmodifiers", "alt+shift+k"])
  return { focus, key, keyFocused, target, windows }
}

type Action = "stop-all" | "switch-off" | "disconnect" | "hotkey"

async function controlRun(action: Action) {
  scenarioLabel = `controls-${action}`
  const out: Record<string, unknown> = { action }
  let error: unknown
  const result = await run(
    (step) => {
      if (step.results.length === 0) return navigate(localOrigin)
      if (step.results.length === 1) return snapshot
      if (step.results.length === 2) {
        return (async () => {
          try {
            out["during"] = { groups: (await tabState()).groups, section: await sectionText(), storage: await sessionStorage() }
            await shot("01-running")
            const live = liveGroup((await tabState()).groups)
            out["liveGroup"] = live
            const started = Date.now()
            if (action === "stop-all") {
              await panel.getByRole("button", { name: "Stop all" }).click()
            } else if (action === "switch-off") {
              await setSwitch(false)
            } else if (action === "disconnect") {
              const button = panel.getByRole("button", { name: /^Disconnect / })
              out["disconnectLabel"] = await button.getAttribute("aria-label")
              await button.click()
            } else {
              await panel.bringToFront()
              out["hotkey"] = await pressHotkey()
            }
            const ended = await maybe(async () => {
              if (typeof live?.id !== "number") return undefined
              const group = record(await worker.evaluate(async (id: number) => chrome.tabGroups.get(id), live.id))
              return group?.["title"] === "Kilo · ended" ? group : undefined
            }, 10_000)
            out["endedGroup"] = ended ?? null
            out["endedMs"] = ended === undefined ? null : Date.now() - started
            await Bun.sleep(500)
            out["after"] = { groups: (await tabState()).groups, section: await sectionText(), storage: await sessionStorage() }
            await shot("02-after-action")
          } catch (caught) {
            error = caught
          }
          return navigate(`${localOrigin}/?after=${action}`)
        })()
      }
      if (step.results.length === 3) return snapshot
      return undefined
    },
    {},
    { label: action },
  )
  out["error"] = error === undefined ? null : String(error)
  out["results"] = result.last.results.map((text) => text.slice(0, 700))
  out["next"] = result.last.results[2] ?? null
  out["afterNext"] = result.last.results[3] ?? null
  out["events"] = toolEvents(result.stdout).slice(-3)
  out["final"] = { groups: (await tabState()).groups, section: await sectionText() }
  out["hubLog"] = result.hub.log.text.slice(-1_200)
  out["code"] = result.code
  await shot("03-run-ended")
  return out
}

async function controlsScenario() {
  await setSwitch(true)
  const results: Record<string, unknown> = {}
  const commands = await worker.evaluate(() => chrome.commands.getAll())
  results["commands"] = commands
  for (const action of ["stop-all", "switch-off", "disconnect", "hotkey"] as const) {
    results[action] = await controlRun(action)
    const item = record(results[action])
    if (action === "switch-off") await setSwitch(true)
    const next = String(item?.["next"] ?? "")
    if (action === "disconnect") {
      const afterNext = String(item?.["afterNext"] ?? "")
      const finalGroups = (field(item?.["final"], "groups") ?? []) as GroupInfo[]
      expectKnown(
        "controls:disconnect",
        next.includes("The user stopped this browser session") &&
          afterNext.includes("The user stopped this browser session") &&
          liveGroup(finalGroups) === undefined,
        `Disconnect did not stop the agent for good: next=${next.slice(0, 200).replace(/\n/g, " ")}; afterNext=${afterNext.slice(0, 200).replace(/\n/g, " ")}; groups=${JSON.stringify(finalGroups)}`,
      )
    } else {
      expect(next.includes("The user stopped this browser session"), `${action}: the next call was not user_stopped: ${next.slice(0, 300)}`)
    }
    expect(item?.["endedGroup"] !== null, `${action}: the live group never turned "Kilo · ended": ${JSON.stringify(item?.["after"])}`)
    const live = record(item?.["liveGroup"])
    observe(
      typeof live?.["title"] !== "string" || !/Kilo · (ses_|[0-9A-Z]{20,})/.test(String(live["title"])),
      `${action}: the live group title is an opaque session id: "${String(live?.["title"])}"`,
    )
  }
  return results
}

// ---------------------------------------------------------------------------------------------
// Scenario: the model-visible text of every error.
// ---------------------------------------------------------------------------------------------

type Captured = { reachable: boolean; text: string | null; how: string; judge?: Judgement; extra?: unknown }

async function errorsScenario() {
  scenarioLabel = "errors"
  await setSwitch(true)
  const out: Record<string, Captured> = {}
  const capture = (key: string, how: string, text: string | undefined, extra?: unknown) => {
    out[key] = { how, reachable: text !== undefined, text: text ?? null, ...(text === undefined ? {} : { judge: judge(text) }), ...(extra === undefined ? {} : { extra }) }
  }

  // blocked: pages the extension never drives.
  {
    const targets = ["chrome://settings/", "https://chromewebstore.google.com/", "file:///etc/hostname", "view-source:http://127.0.0.1/"]
    const result = await run((step) => (step.results.length < targets.length ? navigate(targets[step.results.length]!) : undefined), {}, { label: "blocked" })
    targets.forEach((target, index) => capture(`blocked:${target}`, `browser_navigate ${target}`, result.last.results[index]))
    out["blocked:declared-tools"] = { how: "tools the model was offered", reachable: true, text: (result.last.tools ?? []).join(",") }
  }

  // needs_permission: a non-localhost origin with no grant, non-interactive (the CLI cannot ask) and with a deny rule.
  {
    const ask = await run((step) => (step.results.length === 0 ? navigate(`${publicOrigin}/public`) : undefined), { strict: true }, { label: "needs-ask" })
    capture("needs_permission:ask-noninteractive", "strict rules, navigate 127.0.0.2, no TUI", ask.last.results[0])
    const deny = await run((step) => (step.results.length === 0 ? navigate(`${publicOrigin}/public`) : undefined), {
      rules: [{ action: "browser", effect: "deny", resource: `navigate:${publicOrigin}` }],
      strict: true,
    }, { label: "needs-deny" })
    capture("needs_permission:deny-rule", `deny rule browser navigate:${publicOrigin}`, deny.last.results[0])
    // The second ask class: navigation granted, reading the page not.
    const read = await run(
      (step) => (step.results.length === 0 ? navigate(`${publicOrigin}/public`) : step.results.length === 1 ? snapshot : undefined),
      { rules: [{ action: "browser", effect: "allow", resource: `navigate:${publicOrigin}` }], strict: true },
      { label: "needs-read" },
    )
    capture("needs_permission:read-after-navigate", "navigate granted, read not (non-interactive)", read.last.results[1], { navigate: read.last.results[0]?.slice(0, 400) })
    // The sensitive step (a password fill) under a `*` allow rule, then with `allow_sensitive`.
    // The model follows the text's advice once: a refused fill that says "Call the tool again" is repeated.
    const passwordPlan: Plan = (step) => {
      if (step.results.length === 0) return navigate(localOrigin)
      if (step.results.length === 1) return snapshot
      const ref = refOf(step.results[1] ?? "", /textbox "Password" \[ref=([^\]]+)\]/)
      const fill: Call | undefined = ref ? { args: { element: "the password field", target: ref, text: PASSWORD_VALUE }, name: "browser_type" } : undefined
      if (step.results.length === 2) return fill
      if (step.results.length === 3 && /Call the tool again/.test(step.results[2] ?? "")) return fill
      return undefined
    }
    recorded.length = 0
    const sensitiveAll = await run(passwordPlan, {}, { label: "sensitive-allow-all" })
    capture("needs_permission:sensitive-allow-all", "password fill, `*` allow rule, non-interactive", sensitiveAll.last.results[2], { recorded: [...recorded], repeat: sensitiveAll.last.results[3] ?? null })
    recorded.length = 0
    const sensitiveOn = await run(passwordPlan, { allowSensitive: true }, { label: "sensitive-allowed" })
    await Bun.sleep(500)
    capture("needs_permission:sensitive-allow_sensitive", "password fill with browser.allow_sensitive", sensitiveOn.last.results[2], { recorded: [...recorded], repeat: sensitiveOn.last.results[3] ?? null })
  }

  // origin_changed: a granted localhost URL that redirects to the ungranted public origin; and a click that leaves.
  {
    // The model does what the text says ("Call the tool again") three times: does the advice converge?
    const result = await run((step) => (step.results.length < 3 ? navigate(`${localOrigin}/redirect`) : undefined), { strict: true }, { label: "origin-changed" })
    capture("origin_changed:navigate-redirect", "navigate 127.0.0.1/redirect → 302 → 127.0.0.2 (strict, non-interactive), repeated 3x as advised", result.last.results[0], {
      repeats: result.last.results.slice(1),
    })
    const interactive = await run(
      (step) => (step.results.length < 2 ? navigate(`${localOrigin}/redirect`) : undefined),
      { rules: [{ action: "browser", effect: "allow", resource: `*:${publicOrigin}` }], strict: true },
      { label: "origin-changed-granted" },
    )
    out["origin_changed:redirect-granted"] = { how: "same redirect with 127.0.0.2 granted by rule", reachable: true, text: interactive.last.results[0] ?? null, extra: { repeat: interactive.last.results[1] } }
    const click = await run(
      (step) => {
        if (step.results.length === 0) return navigate(localOrigin)
        if (step.results.length === 1) return snapshot
        if (step.results.length === 2) {
          const ref = refOf(step.results[1] ?? "", /link "Go away" \[ref=([^\]]+)\]/)
          return ref ? { args: { element: "the Go away link", target: ref }, name: "browser_click" } : undefined
        }
        return undefined
      },
      { strict: true },
      { label: "origin-changed-click" },
    )
    capture("origin_changed:click-redirect", "click a link that redirects to 127.0.0.2 (strict)", click.last.results[2])
  }

  // tab_busy: two calls on the session's one tab at once, the first holding it past the agent wait (30 s).
  {
    const result = await run(
      (step) => {
        if (step.results.length === 0) return navigate(localOrigin)
        if (step.results.length === 1) return [navigate(`${localOrigin}/slow?ms=45000`), snapshot]
        return undefined
      },
      {},
      { label: "tab-busy" },
    )
    const texts = result.last.results.slice(1)
    const busy = texts.find((text) => /busy/i.test(text))
    capture("tab_busy", "navigate to a 45 s page and snapshot in parallel", busy, { all: texts.map((text) => text.slice(0, 500)), mode: result.last.tools.includes("execute") ? "code" : "tools" })
  }

  out["tab_taken"] = {
    how: "needs a panel or user take-over of the agent's tab (the side-panel take-over card); out of this runner's scope",
    reachable: false,
    text: null,
  }

  // user_stopped: Stop all between two calls.
  {
    const result = await run(
      (step) => {
        if (step.results.length === 0) return navigate(localOrigin)
        if (step.results.length === 1) {
          return (async () => {
            await panel.getByRole("button", { name: "Stop all" }).click()
            await Bun.sleep(1_000)
            return snapshot
          })()
        }
        if (step.results.length === 2) return navigate(`${localOrigin}/?again=1`)
        return undefined
      },
      {},
      { label: "user-stopped" },
    )
    capture("user_stopped", "Stop all, then snapshot", result.last.results[1], { repeat: result.last.results[2] })
  }

  // browser_unavailable: a hub nobody is paired with; and the hub dying between two calls.
  {
    const result = await run((step) => (step.results.length === 0 ? navigate(localOrigin) : undefined), {}, { label: "unavailable", pair: false })
    capture("browser_unavailable:unpaired", "hub running, extension never paired with it", result.last.results[0], { events: toolEvents(result.stdout), stderr: result.stderr.slice(-800) })
    const midRoot = await freshRoot("unavailable-mid")
    const midHub = await startHub(midRoot, {})
    await pair(midHub)
    const mid = await run(
      (step) => {
        if (step.results.length === 0) return navigate(localOrigin)
        if (step.results.length === 1) return (async () => (await midHub.stop(), snapshot))()
        return undefined
      },
      {},
      { hub: midHub, label: "unavailable-mid" },
    )
    capture("browser_unavailable:hub-died", "hub process stopped between two calls", mid.last.results[1], { events: toolEvents(mid.stdout).slice(-2) })
  }

  // unsupported_in_browser: only when the extension lists fewer tools than the CLI's pinned contract.
  out["unsupported_in_browser"] = {
    how: "the extension serves every contract tool at this build pair (the declared tool list above is the pinned contract); the only -32005 route is upload.begin, which the CLI absorbs",
    reachable: false,
    text: null,
  }
  for (const [key, value] of Object.entries(out)) {
    if (value.judge?.transportLeak) observations.push(`${key}: model text names a transport detail "${value.judge.transportLeak}": ${String(value.text).slice(0, 300)}`)
  }
  return out
}

// ---------------------------------------------------------------------------------------------
// Scenario: the TUI in tmux.
// ---------------------------------------------------------------------------------------------

const shellQuote = (value: string) => `'${value.replaceAll("'", `'\\''`)}'`

async function tmux(args: string[]) {
  const child = Bun.spawn(["tmux", ...args], { stderr: "pipe", stdout: "pipe" })
  const [out, err, code] = await Promise.all([
    new Response(child.stdout as ReadableStream).text(),
    new Response(child.stderr as ReadableStream).text(),
    child.exited,
  ])
  if (code !== 0) throw new Error(`tmux ${args.join(" ")}: ${err}`)
  return out
}

const pane = (name: string) => tmux(["capture-pane", "-t", name, "-p", "-S", "-200"])

/** The tmux session names of this run: unique per process, so runs of several agents on one machine never collide. */
const TMUX_PREFIX = `ux-e2e-${process.pid}`

/** Saves the pane as `<scenario>-<label>.pane.txt`: the given capture, or a fresh one. */
async function savePane(name: string, label: string, captured?: string) {
  const text = captured ?? (await pane(name))
  await fs.mkdir(evidence, { recursive: true })
  const file = path.join(evidence, `${scenarioLabel}-${label}.pane.txt`)
  await fs.writeFile(file, text)
  shots.push(file)
  return text
}

async function startTui(root: string, settings: Settings, name: string, settleMs = 1_500) {
  const env = environment(root, settings)
  const lines = Object.entries(env)
    .filter(([key]) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(key))
    .map(([key, value]) => `export ${key}=${shellQuote(value)}`)
  const launcher = path.join(root, "tui.sh")
  await fs.writeFile(
    launcher,
    `${lines.join("\n")}\nexport TERM=xterm-256color\ncd ${shellQuote(root)}\nexec ${shellQuote(binary)} --standalone --model local/echo\n`,
    { mode: 0o700 },
  )
  await tmux(["kill-session", "-t", name]).catch(() => undefined)
  await tmux(["new-session", "-d", "-s", name, "-x", "200", "-y", "50", "-c", root, `bash ${shellQuote(launcher)}`])
  await until(async () => ((await pane(name)).trim().length > 40 ? true : undefined), 30_000, "the TUI draws")
  await Bun.sleep(settleMs)
}

/** Types the prompt and submits it; an Enter the TUI drops while it is still booting is pressed again. */
async function prompt(name: string, text: string) {
  const before = model.requests
  await tmux(["send-keys", "-t", name, "-l", text])
  for (let tries = 0; tries < 4; tries++) {
    await Bun.sleep(500)
    await tmux(["send-keys", "-t", name, "Enter"])
    if (await maybe(() => (model.requests > before ? true : undefined), 8_000)) return
  }
  throw new Error(`the TUI never sent the prompt: ${(await pane(name)).split("\n").filter((line) => line.trim()).slice(-8).join(" / ")}`)
}

const waitPane = (name: string, pattern: RegExp, timeout = 30_000) =>
  maybe(async () => {
    const text = await pane(name)
    return pattern.test(text) ? text : undefined
  }, timeout)

async function tuiPermission(choice: "once" | "always" | "reject") {
  scenarioLabel = `tui-${choice}`
  const root = await freshRoot(`tui-${choice}`)
  const settings: Settings = { strict: true }
  const hub = await startHub(root, settings)
  await pair(hub)
  history.length = 0
  const out: Record<string, unknown> = { choice }
  model.plan = (step) => {
    if (step.results.length === 0) return navigate(`${publicOrigin}/public`)
    if (step.results.length === 1) return navigate(`${publicOrigin}/public?second=1`)
    if (step.results.length === 2) return snapshot
    return undefined
  }
  const name = `${TMUX_PREFIX}-tui-${choice}`
  try {
    await startTui(root, settings, name)
    await prompt(name, "Open the public page twice.")
    const first = await waitPane(name, /Permission required/, 60_000)
    out["firstPrompt"] = first === undefined ? null : await savePane(name, "01-prompt", first)
    expect(first !== undefined, `${choice}: no permission prompt for navigate:${publicOrigin}`)
    expectKnown(
      "tui:prompt-text",
      first === undefined ||
        (first.includes(`Open pages on ${publicOrigin}`) &&
          first.includes(`Approving lets this conversation open pages on ${publicOrigin} until it ends.`)),
      `${choice}: the navigate prompt does not read "Open pages on ${publicOrigin}" with "Approving lets this conversation open pages on ${publicOrigin} until it ends."`,
    )
    if (choice === "once") await tmux(["send-keys", "-t", name, "Enter"])
    if (choice === "always") await tmux(["send-keys", "-t", name, "Right", "Enter"])
    if (choice === "reject") await tmux(["send-keys", "-t", name, "Escape"])
    await Bun.sleep(3_000)
    out["afterChoice"] = await savePane(name, "02-after-choice")
    const second = await waitPane(name, /Permission required/, 8_000)
    out["secondPrompted"] = second !== undefined
    if (second !== undefined) {
      out["secondPrompt"] = await savePane(name, "03-second-prompt", second)
      await tmux(["send-keys", "-t", name, "Enter"])
      await Bun.sleep(3_000)
    }
    const third = await waitPane(name, /Permission required/, 6_000)
    out["thirdPrompted"] = third !== undefined
    if (third !== undefined) {
      out["thirdPrompt"] = await savePane(name, "04-third-prompt", third)
      await tmux(["send-keys", "-t", name, "Enter"])
    }
    const prompts = [first, second, third].filter((text): text is string => text !== undefined)
    expectKnown(
      "tui:prompt-text",
      !prompts.some((text) => text.includes("Call tool browser")),
      `${choice}: a browser prompt still reads "Call tool browser"`,
    )
    if (choice === "once") observe(second?.includes(`Open pages on ${publicOrigin}`) === true, `once: "Allow once" on the first navigate did not ask again for the second navigate to ${publicOrigin}`)
    if (choice !== "reject") {
      const read = prompts.find((text) => text.includes(`Read pages on ${publicOrigin}`))
      expectKnown(
        "tui:prompt-text",
        read !== undefined && read.includes(`Approving lets this conversation read pages on ${publicOrigin} until it ends.`),
        `${choice}: no prompt reads "Read pages on ${publicOrigin}" with "Approving lets this conversation read pages on ${publicOrigin} until it ends." for the snapshot`,
      )
    }
    await maybe(async () => (history.at(-1)?.results.length ?? 0) >= 3 || (choice === "reject" && (history.at(-1)?.results.length ?? 0) >= 1) ? true : undefined, 30_000)
    await Bun.sleep(2_000)
    out["final"] = await savePane(name, "05-final")
    out["modelResults"] = (history.at(-1)?.results ?? []).map((text) => text.slice(0, 600))
  } finally {
    model.plan = undefined
    await tmux(["kill-session", "-t", name]).catch(() => undefined)
    await hub.stop()
  }
  return out
}

/**
 * The toast on screen, as one line of text: the TUI draws it at the top right between two `┃` borders, word-wrapped
 * inside at most 60 columns, so its rows are the right-edge `┃ … ┃` segments of the first rows of the pane.
 */
function toastOf(text: string) {
  const parts: string[] = []
  for (const line of text.split("\n").slice(0, 20)) {
    const match = /┃([^┃]*)┃\s*$/.exec(line)
    if (match === null || match.index < line.length - 66) continue
    // The first row ends with the dismiss affordance "x".
    const part = (match[1] ?? "").replace(/\s+/g, " ").trim().replace(/\s+x$/, "")
    if (part) parts.push(part)
  }
  return parts.join(" ")
}

/**
 * Whether a toast reads `expected`. Spacing is ignored: the toast word-wraps at "/" too ("Run /" | "browser adopt"),
 * and `toastOf` joins its rows with a space.
 */
const toastReads = (toast: string | undefined, expected: string) =>
  toast !== undefined && toast.replace(/\s+/g, "").includes(expected.replace(/\s+/g, ""))

/** Waits for a toast that reads `expected` (or one of them); the pane is saved the moment it shows. `seen` lists every toast meanwhile. */
async function waitToast(name: string, expected: string | string[], label: string, timeout = 20_000) {
  const accepted = typeof expected === "string" ? [expected] : expected
  const seen = new Set<string>()
  const shown = await maybe(async () => {
    const text = await pane(name)
    const toast = toastOf(text)
    if (toast) seen.add(toast)
    return accepted.some((one) => toastReads(toast, one)) ? text : undefined
  }, timeout)
  const saved = await savePane(name, shown === undefined ? `${label}-no-toast` : label, shown)
  return { pane: saved, seen: [...seen], shown: shown !== undefined, toast: toastOf(saved) }
}

/** The server runs (`run=<id>` in the shared opencode.log of `root`) that have announced their commands, i.e. loaded their plugins. */
async function loadedRuns(root: string) {
  const log = await fs.readFile(path.join(root, "data", "kilo2", "log", "opencode.log"), "utf8").catch(() => "")
  return new Set([...log.matchAll(/run=([0-9a-f]+) message=event .*event\.type=command\.updated/g)].map((match) => match[1]!))
}

/**
 * Starts a TUI and waits until its server loaded the location's plugins: a new run id announces `command.updated` in
 * the shared log, and the pane names the model with no startup line left. A `/browser` command typed earlier reaches
 * the server before the browser plugin registered its RPC (see the `early` step of share-adopt).
 */
async function startSettledTui(root: string, settings: Settings, name: string) {
  const known = await loadedRuns(root)
  await startTui(root, settings, name)
  const started = Date.now()
  await until(async () => {
    const runs = await loadedRuns(root)
    const text = await pane(name)
    return [...runs].some((run) => !known.has(run)) && text.includes("Echo") && !/Loading plugins|Finishing startup/.test(text) ? true : undefined
  }, 60_000, `${name} finishes starting`)
  await Bun.sleep(1_000)
  return Date.now() - started
}

/**
 * Every distinct pane line that mentions a browser state, and every toast, sampled every 250 ms: toasts and spinners
 * that are gone by the time the run ends still land here. `masked` and `leaks` keep whole lines that show the masked
 * typed text or the password itself.
 */
function watchPane(name: string) {
  const seen = new Set<string>()
  const toasts = new Set<string>()
  const masked = new Set<string>()
  const leaks = new Set<string>()
  const pattern = /Allow local agents|stopped|not available|Permission|sensitive|password|Error|browser\./i
  let running = true
  const loop = (async () => {
    while (running) {
      const text = await pane(name).catch(() => "")
      for (const line of text.split("\n")) {
        const trimmed = line.replace(/\s{3,}.*$/, "").trim()
        if (trimmed && pattern.test(trimmed)) seen.add(trimmed)
        if (line.includes("•••")) masked.add(line.trim())
        if (line.includes(PASSWORD_VALUE)) leaks.add(line.trim())
      }
      const toast = toastOf(text)
      if (toast) toasts.add(toast)
      await Bun.sleep(250)
    }
  })()
  return async () => {
    running = false
    await loop
    return { leaks: [...leaks], lines: [...seen], masked: [...masked], toasts: [...toasts] }
  }
}

/** `ask`: sensitive steps ask (the shipped default for a human); `allow-all`: a `*` allow rule, as many configs have. */
async function tuiSensitiveAndStop(mode: "ask" | "allow-all") {
  scenarioLabel = `tui-sensitive-stop-${mode}`
  const root = await freshRoot(`tui-sensitive-${mode}`)
  const settings: Settings =
    mode === "ask" ? { rules: [{ action: "browser", effect: "ask", resource: "sensitive:*" }], strict: true } : {}
  const hub = await startHub(root, settings)
  await pair(hub)
  history.length = 0
  recorded.length = 0
  const out: Record<string, unknown> = { mode }
  let stopDone = false
  // A click first establishes the act grant (as extension-e2e's `sensitive` does), so the fill's own call is the one
  // classified sensitive; the errors scenario covers the fill without it.
  model.plan = (step) => {
    if (step.results.length === 0) return navigate(localOrigin)
    if (step.results.length === 1) return snapshot
    if (step.results.length === 2) {
      const ref = refOf(step.results[1] ?? "", /button "Click me" \[ref=([^\]]+)\]/)
      return ref ? { args: { element: "the Click me button", target: ref }, name: "browser_click" } : undefined
    }
    if (step.results.length === 3) {
      const ref = refOf(step.results[1] ?? "", /textbox "Password" \[ref=([^\]]+)\]/)
      return ref ? { args: { element: "the password field", target: ref, text: PASSWORD_VALUE }, name: "browser_type" } : undefined
    }
    if (step.results.length === 4) {
      return (async () => {
        await panel.getByRole("button", { name: "Stop all" }).click()
        await Bun.sleep(1_000)
        stopDone = true
        return snapshot
      })()
    }
    return undefined
  }
  const name = `${TMUX_PREFIX}-tui-sensitive-${mode}`
  try {
    await startTui(root, settings, name)
    const watched = watchPane(name)
    await prompt(name, "Type the password.")
    const sensitivePrompt = await waitPane(name, /Permission required/i, 60_000)
    out["sensitivePrompt"] = sensitivePrompt === undefined ? null : await savePane(name, "01-sensitive-prompt", sensitivePrompt)
    expect(mode !== "ask" || sensitivePrompt !== undefined, `${mode}: no sensitive-step prompt in the TUI for a password fill`)
    if (sensitivePrompt !== undefined) {
      out["sensitiveReason"] = /Reason: .*?(?=\s{3,}|$)/m.exec(sensitivePrompt)?.[0] ?? null
      expectKnown(
        "tui:prompt-text",
        sensitivePrompt.includes(`Sensitive browser step on ${localOrigin}`) &&
          out["sensitiveReason"] !== null &&
          !sensitivePrompt.includes("Call tool browser"),
        `${mode}: the sensitive prompt does not read "Sensitive browser step on ${localOrigin}" with a "Reason: …" line`,
      )
    }
    if (sensitivePrompt !== undefined) await tmux(["send-keys", "-t", name, "Enter"])
    await Bun.sleep(2_000)
    const again = await waitPane(name, /Permission required/i, 5_000)
    if (again !== undefined) {
      out["secondPrompt"] = await savePane(name, "02-second-prompt", again)
      await tmux(["send-keys", "-t", name, "Enter"])
    }
    await maybe(() => (stopDone ? true : undefined), 40_000)
    await maybe(async () => ((history.at(-1)?.results.length ?? 0) >= 5 ? true : undefined), 20_000)
    await Bun.sleep(2_500)
    out["afterStop"] = await savePane(name, "03-after-stop")
    const watchedState = await watched()
    out["paneLines"] = watchedState.lines
    out["toasts"] = watchedState.toasts
    out["maskedLines"] = watchedState.masked
    out["leakedLines"] = watchedState.leaks
    const panes = [sensitivePrompt, again, String(out["afterStop"])].filter((text): text is string => text !== undefined)
    // The running browser.type row sits above the sensitive prompt, so the saved prompt pane holds it for certain; the
    // watcher may sample too few frames to see it.
    const leaked = [
      ...new Set([
        ...watchedState.leaks,
        ...panes.flatMap((text) => text.split("\n").filter((line) => line.includes(PASSWORD_VALUE)).map((line) => line.trim())),
      ]),
    ]
    expectKnown(
      "tui:masked-text",
      leaked.length === 0 &&
        (watchedState.masked.some((line) => line.includes("text=•••")) || panes.some((text) => text.includes("text=•••"))),
      leaked.length > 0
        ? `${mode}: the pane shows the typed password: ${leaked.join(" / ")}`
        : `${mode}: no tool row shows "text=•••"`,
    )
    expectKnown(
      "tui:notices",
      watchedState.toasts.some((toast) => toastReads(toast, "You stopped the browser for this session. Run /browser adopt to give it its tabs back.")),
      `${mode}: no "You stopped the browser for this session…" toast after Stop all; toasts: ${JSON.stringify(watchedState.toasts)}`,
    )
    out["recorded"] = [...recorded]
    out["modelResults"] = (history.at(-1)?.results ?? []).map((text) => text.slice(0, 600))
  } finally {
    model.plan = undefined
    await tmux(["kill-session", "-t", name]).catch(() => undefined)
    await hub.stop()
  }
  return out
}

async function tuiUnavailable() {
  scenarioLabel = "tui-unavailable"
  const root = await freshRoot("tui-unavailable")
  const settings: Settings = {}
  const hub = await startHub(root, settings)
  history.length = 0
  model.plan = (step) => (step.results.length === 0 ? navigate(localOrigin) : undefined)
  const name = `${TMUX_PREFIX}-tui-unavailable`
  const out: Record<string, unknown> = {}
  try {
    await startTui(root, settings, name)
    const watched = watchPane(name)
    await prompt(name, "Open the local page.")
    await maybe(async () => ((history.at(-1)?.results.length ?? 0) >= 1 ? true : undefined), 40_000)
    await Bun.sleep(4_000)
    out["pane"] = await savePane(name, "01-unavailable")
    const watchedState = await watched()
    out["paneLines"] = watchedState.lines
    out["toasts"] = watchedState.toasts
    out["modelResults"] = (history.at(-1)?.results ?? []).map((text) => text.slice(0, 600))
    const toast = watchedState.toasts.find((text) => text.startsWith("Browser not available"))
    out["unavailableToast"] = toast ?? null
    // The hub runs but no extension ever paired, so the hint is the "unpaired" one (kilo-plugin extensionHint).
    expectKnown(
      "tui:notices",
      toastReads(toast, 'No Kilo browser extension has connected yet: install it, or turn on "Allow local agents"'),
      `the TUI shows no "Browser not available" toast with the unpaired install hint; toasts: ${JSON.stringify(watchedState.toasts)}`,
    )
  } finally {
    model.plan = undefined
    await tmux(["kill-session", "-t", name]).catch(() => undefined)
    await hub.stop()
  }
  return out
}

/** A redirect to an ungranted origin, answered "Allow once" by a person: one prompt, and the navigate lands there. */
async function tuiRedirect() {
  scenarioLabel = "tui-redirect"
  const root = await freshRoot("tui-redirect")
  const settings: Settings = { strict: true }
  const hub = await startHub(root, settings)
  await pair(hub)
  history.length = 0
  const out: Record<string, unknown> = {}
  model.plan = (step) => (step.results.length === 0 ? navigate(`${localOrigin}/redirect`) : undefined)
  const name = `${TMUX_PREFIX}-tui-redirect`
  let prompts = 0
  try {
    await startTui(root, settings, name)
    await prompt(name, "Open the redirecting page twice.")
    for (;;) {
      const asked = await waitPane(name, /Permission required/, prompts === 0 ? 60_000 : 8_000)
      if (asked === undefined) break
      prompts += 1
      out[`prompt${prompts}`] = await savePane(name, `0${prompts}-prompt`)
      await tmux(["send-keys", "-t", name, "Enter"])
      await Bun.sleep(3_000)
      if (prompts >= 4) break
    }
    await maybe(async () => ((history.at(-1)?.results.length ?? 0) >= 1 ? true : undefined), 30_000)
    await Bun.sleep(1_500)
    out["final"] = await savePane(name, "09-final")
    out["prompts"] = prompts
    const results = (history.at(-1)?.results ?? []).map((text) => text.slice(0, 600))
    out["modelResults"] = results
    expect(prompts === 1, `redirect: expected one permission prompt, saw ${prompts}`)
    expect(
      results.length === 1 && (results[0] ?? "").includes(`${publicOrigin}/public`),
      `redirect: the navigate did not land on ${publicOrigin}: ${JSON.stringify(results)}`,
    )
  } finally {
    model.plan = undefined
    await tmux(["kill-session", "-t", name]).catch(() => undefined)
    await hub.stop()
  }
  return out
}

async function tuiScenario() {
  await setSwitch(true)
  return {
    once: await tuiPermission("once"),
    always: await tuiPermission("always"),
    reject: await tuiPermission("reject"),
    sensitiveAsk: await tuiSensitiveAndStop("ask"),
    sensitiveAllowAll: await tuiSensitiveAndStop("allow-all"),
    unavailable: await tuiUnavailable(),
  }
}

// ---------------------------------------------------------------------------------------------
// Scenario: `/browser share` and `/browser adopt` in the TUI (SPEC D9, D12). Every TUI shares one hub and one home.
// ---------------------------------------------------------------------------------------------

/** Types a slash command into the TUI's prompt and submits it. */
async function command(name: string, text: string) {
  await tmux(["send-keys", "-t", name, "-l", text])
  await Bun.sleep(700)
  await tmux(["send-keys", "-t", name, "Enter"])
}

/**
 * Types `/browser` alone and returns the slash-list rows it shows (the `/browser` rows with the command's description,
 * and every pane line naming `/browser`), then types ` <rest>` (the space closes the list) and submits it.
 */
async function browserCommandWithList(name: string, rest: string) {
  await tmux(["send-keys", "-t", name, "-l", "/browser"])
  const text = (await waitPane(name, /\/browser\s+Show the browser/, 10_000)) ?? (await pane(name))
  const saved = await savePane(name, "a-02a-browser-autocomplete", text)
  const lines = saved.split("\n").filter((line) => line.includes("/browser"))
  const rows = lines.filter((line) => /\/browser\s+Show the browser/.test(line))
  await tmux(["send-keys", "-t", name, "-l", ` ${rest}`])
  await Bun.sleep(700)
  await tmux(["send-keys", "-t", name, "Enter"])
  return { lines: lines.map((line) => line.trim()), rows: rows.length }
}

/** Makes `tabId` the active tab of a focused window, and returns what `tabs.query({ active, lastFocusedWindow })` answers. */
async function activate(tabId: number) {
  return worker.evaluate(async (id: number) => {
    const tab = await chrome.tabs.update(id, { active: true })
    await chrome.windows.update(tab.windowId, { focused: true })
    const active = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
    return Array.isArray(active) ? ((active[0] as { id?: number } | undefined)?.id ?? null) : null
  }, tabId)
}

type TabFacts = { group: GroupInfo | null; groupId: number; tabId: number; url: string | null }

async function tabFacts(tabId: number): Promise<TabFacts> {
  const tab = record(await worker.evaluate(async (id: number) => chrome.tabs.get(id), tabId))
  const groupId = typeof tab?.["groupId"] === "number" ? (tab["groupId"] as number) : -1
  return {
    group: groupId >= 0 ? await groupById(worker, groupId) : null,
    groupId,
    tabId,
    url: typeof tab?.["url"] === "string" ? (tab["url"] as string) : null,
  }
}

/** The tab whose URL carries `marker`, once it exists and sits in a group. */
async function groupedTab(marker: string) {
  const id = await until(
    async () => (await tabState()).tabs.find((tab) => tab.url?.includes(marker) && typeof tab.groupId === "number" && tab.groupId >= 0)?.id,
    30_000,
    `a grouped tab at ${marker}`,
  )
  return tabFacts(id)
}

/** One TUI session whose model navigates once to `?session=<label>`; the TUI stays open. */
async function navigatingSession(root: string, settings: Settings, label: string) {
  const name = `${TMUX_PREFIX}-sa-${label}`
  history.length = 0
  model.plan = (step) => (step.results.length === 0 ? navigate(`${localOrigin}/?session=${label}`) : undefined)
  let startMs = 0
  try {
    startMs = await startSettledTui(root, settings, name)
    await prompt(name, `Open the local page for session ${label}.`)
    await until(async () => ((history.at(-1)?.results.length ?? 0) >= 1 ? true : undefined), 60_000, `session ${label} navigates`)
    await Bun.sleep(2_000)
  } finally {
    model.plan = undefined
  }
  return { name, result: history.at(-1)?.results[0]?.slice(0, 300) ?? null, startMs, tab: await groupedTab(`session=${label}`) }
}

async function tmuxAlive(name: string) {
  return tmux(["has-session", "-t", name]).then(
    () => true,
    () => false,
  )
}

async function shareAdoptScenario() {
  scenarioLabel = "share-adopt"
  await setSwitch(true)
  const root = await freshRoot("share-adopt")
  const settings: Settings = {}
  const hub = await startHub(root, settings)
  const out: Record<string, unknown> = {}
  const sessions: string[] = []
  try {
    await pair(hub)
    // (a) Share: session A has a group; the user's own new tab, made active, joins it on `/browser share`.
    const a = await navigatingSession(root, settings, "A")
    sessions.push(a.name)
    await savePane(a.name, "a-01-navigated")
    const groupA = a.tab.group
    expect(groupA !== null && groupA.title?.startsWith("Kilo · ") === true && groupA.title !== "Kilo · ended", `A's tab is not in a live Kilo group: ${JSON.stringify(a.tab)}`)
    const userTab = await openUserTab(launched!, `${localOrigin}/?user=share`)
    const activeBeforeShare = await activate(userTab)
    const userBefore = await tabFacts(userTab)
    const list = await browserCommandWithList(a.name, "share")
    out["autocomplete"] = list
    expect(list.rows === 1, `typing "/browser" shows ${list.rows} "/browser" rows in the slash list, not one: ${JSON.stringify(list.lines)}`)
    const shareToast = await waitToast(a.name, "Your active tab is now in this session's tab group.", "a-02-share-toast")
    const userAfter = await tabFacts(userTab)
    out["share"] = { activeBeforeShare, groupA, sessionATab: a.tab, toast: shareToast.toast, userAfter, userBefore, userTab }
    expect(activeBeforeShare === userTab, `the user tab ${userTab} was not the active tab before the share (active: ${activeBeforeShare})`)
    expect(shareToast.shown, `share: no "Your active tab is now in this session's tab group." toast; toast: "${shareToast.toast}"`)
    expect(userAfter.groupId === a.tab.groupId && userAfter.group?.title === groupA?.title, `share: the user tab is not in A's group: ${JSON.stringify(userAfter)}`)

    // (b) Held: session B has its own group; A's tab is active; B's `/browser share` is refused and the tab stays.
    const b = await navigatingSession(root, settings, "B")
    sessions.push(b.name)
    await savePane(b.name, "b-01-navigated")
    expect(b.tab.groupId !== a.tab.groupId && b.tab.groupId >= 0, `B has no group of its own: ${JSON.stringify(b.tab)}`)
    const activeBeforeHeld = await activate(a.tab.tabId)
    await command(b.name, "/browser share")
    const heldToast = await waitToast(b.name, "The active tab belongs to another agent session. Switch to another tab, then share again.", "b-02-held-toast")
    const heldAfter = await tabFacts(a.tab.tabId)
    out["held"] = { activeBeforeHeld, groupB: b.tab.group, heldAfter, sessionBTab: b.tab, toast: heldToast.toast }
    expect(activeBeforeHeld === a.tab.tabId, `A's tab ${a.tab.tabId} was not active before B's share (active: ${activeBeforeHeld})`)
    expect(heldToast.shown, `held: no "The active tab belongs to another agent session…" toast; toast: "${heldToast.toast}"`)
    expect(heldAfter.groupId === a.tab.groupId, `held: A's tab left A's group: ${JSON.stringify(heldAfter)}`)

    // (c) Adopt: TUI A quits, so its session closes and the group ends; a fresh session C adopts it.
    await savePane(a.name, "c-01-a-before-exit")
    await command(a.name, "/exit")
    let exited = await maybe(async () => ((await tmuxAlive(a.name)) ? undefined : true), 15_000)
    if (!exited) {
      await savePane(a.name, "c-01b-a-exit-pending")
      await tmux(["send-keys", "-t", a.name, "C-c"]).catch(() => undefined)
      await Bun.sleep(500)
      await tmux(["send-keys", "-t", a.name, "C-c"]).catch(() => undefined)
      exited = await maybe(async () => ((await tmuxAlive(a.name)) ? undefined : true), 15_000)
    }
    const ended = await maybe(async () => {
      const group = await groupById(worker, a.tab.groupId)
      return group.title === "Kilo · ended" ? group : undefined
    }, 20_000)
    let endedVia = "TUI A quit (/exit)"
    if (ended === undefined) {
      endedVia = "Stop all (TUI A's exit did not end its group)"
      await panel.getByRole("button", { name: "Stop all" }).click()
    }
    const endedGroup =
      ended ??
      (await maybe(async () => {
        const group = await groupById(worker, a.tab.groupId)
        return group.title === "Kilo · ended" ? group : undefined
      }, 15_000)) ??
      null
    out["ended"] = { endedGroup, endedVia, exited: exited === true, state: await tabState() }
    expect(ended !== undefined, `quitting TUI A did not turn its group "Kilo · ended": ${JSON.stringify(await groupById(worker, a.tab.groupId))}`)

    const cName = `${TMUX_PREFIX}-sa-C`
    sessions.push(cName)
    out["startMsC"] = await startSettledTui(root, settings, cName)
    await command(cName, "/browser adopt")
    const adoptToast = await waitToast(cName, "This session now uses the last ended tab group.", "c-02-adopt-toast")
    const adoptedGroup = await groupById(worker, a.tab.groupId)
    expect(adoptToast.shown, `adopt: no "This session now uses the last ended tab group." toast; toast: "${adoptToast.toast}"`)
    expect(
      adoptedGroup.title === groupA?.title && adoptedGroup.collapsed === false,
      `adopt: A's group is not back to "${groupA?.title}" and expanded: ${JSON.stringify(adoptedGroup)}`,
    )
    history.length = 0
    model.plan = (step) => (step.results.length === 0 ? snapshot : undefined)
    let snapshotText: string | null = null
    try {
      await prompt(cName, "Read the page.")
      await until(async () => ((history.at(-1)?.results.length ?? 0) >= 1 ? true : undefined), 60_000, "C's snapshot")
      snapshotText = history.at(-1)?.results[0] ?? null
      await Bun.sleep(2_000)
    } finally {
      model.plan = undefined
    }
    await savePane(cName, "c-03-snapshot")
    out["adopt"] = {
      adoptedGroup,
      seenToasts: adoptToast.seen,
      snapshot: snapshotText?.slice(0, 800) ?? null,
      state: await tabState(),
      toast: adoptToast.toast,
    }
    expect(
      snapshotText !== null && !/no tab yet/i.test(snapshotText) && snapshotText.includes("Browser E2E"),
      `adopt: C's snapshot did not read the adopted tab: ${String(snapshotText).slice(0, 300)}`,
    )

    // (d) Nothing has ended now: session D's `/browser adopt` has nothing to reuse.
    const dName = `${TMUX_PREFIX}-sa-D`
    sessions.push(dName)
    out["startMsD"] = await startSettledTui(root, settings, dName)
    await command(dName, "/browser adopt")
    const noneToast = await waitToast(dName, "There is no ended tab group to reuse.", "d-01-adopt-none-toast")
    out["adoptNone"] = { seenToasts: noneToast.seen, state: await tabState(), toast: noneToast.toast }
    expect(noneToast.shown, `adopt with nothing ended: no "There is no ended tab group to reuse." toast; toast: "${noneToast.toast}"`)

    // (e) Early: the same `/browser adopt` typed as soon as a fresh TUI draws, before its server loaded the plugins.
    // Nothing has ended, so the TUI either waits for the plugins and answers "nothing to reuse", or says Kilo is still
    // starting; the raw "RPC is unavailable" error must never show. The server's status line is kept as well.
    const eName = `${TMUX_PREFIX}-sa-E`
    sessions.push(eName)
    const before = await loadedRuns(root)
    await startTui(root, settings, eName, 0)
    await command(eName, "/browser adopt")
    const early = await waitToast(eName, ["There is no ended tab group to reuse.", "Kilo is still starting. Try again in a moment."], "e-01-early-adopt-toast", 15_000)
    const log = await fs.readFile(path.join(root, "data", "kilo2", "log", "opencode.log"), "utf8").catch(() => "")
    const serverLines = log
      .split("\n")
      .filter((line) => line.includes("kilocode.browser/adopt") && ![...before].some((run) => line.includes(`run=${run} `)))
    out["early"] = { seenToasts: early.seen, serverLines, shown: early.shown, toast: early.toast }
    expect(
      early.shown,
      `a "/browser adopt" typed right after the TUI drew answered neither "There is no ended tab group to reuse." nor "Kilo is still starting. Try again in a moment."; toasts seen: ${JSON.stringify(early.seen)}; server: ${serverLines.map((line) => /http\.status=\d+/.exec(line)?.[0]).join(", ")}`,
    )
    expect(
      !early.seen.some((toast) => /RPC\s*is\s*unavailable/i.test(toast)),
      `a "/browser adopt" typed right after the TUI drew showed the raw RPC error; toasts seen: ${JSON.stringify(early.seen)}`,
    )

    out["hubLog"] = hub.log.text.slice(-1_500)
    await screen("final")
  } finally {
    model.plan = undefined
    for (const name of sessions) await tmux(["kill-session", "-t", name]).catch(() => undefined)
    await hub.stop()
  }
  return out
}

// ---------------------------------------------------------------------------------------------
// Scenario: the settings error lines. The faults are injected into the settings page only (its storage and
// messaging calls); the service worker and the CLI are untouched.
// ---------------------------------------------------------------------------------------------

async function settingsFaultsScenario() {
  scenarioLabel = "settings-faults"
  const out: Record<string, unknown> = {}
  await setSwitch(true)
  const root = await freshRoot("faults")
  const hub = await startHub(root, {})
  await pair(hub)

  // Command answered `{ ok: false }`: the worker could not run Stop all. Does the page say so? The error line belongs
  // to the Stop all control and goes with the agent rows when the run ends, so it is read while the run is live.
  out["command-not-ok"] = await (async () => {
    let section = "no Stop all button (no agents connected)"
    const result = await run(
      (step) => {
        if (step.results.length === 0) return navigate(localOrigin)
        if (step.results.length === 1) {
          return (async () => {
            await panel.evaluate(() => {
              const api = (globalThis as unknown as { chrome: { runtime: { sendMessage: (...args: unknown[]) => Promise<unknown> } } }).chrome
              Object.defineProperty(api.runtime, "sendMessage", { configurable: true, value: () => Promise.resolve({ ok: false }) })
            })
            await panel.getByRole("button", { name: "Stop all" }).click()
            await Bun.sleep(800)
            section = await sectionText()
            await shot("01-stop-all-not-ok")
            return undefined
          })()
        }
        return undefined
      },
      {},
      { hub, keepHub: true },
    ).catch((error: unknown) => ({ error: String(error) }))
    return { section, result: "error" in result ? result.error : result.last.results.map((text) => text.slice(0, 200)) }
  })()
  expectKnown(
    "settings-faults:stop-all-text",
    String(field(out["command-not-ok"], "section")).includes("Couldn't stop the agents. Try again."),
    `Stop all answered { ok: false } and the settings page shows no Stop all error: ${String(field(out["command-not-ok"], "section"))}`,
  )
  await panel.reload()
  await openSettings()

  // Command rejected (no receiver) during a live run: Disconnect says it failed, worded for Disconnect.
  out["command-rejected"] = await (async () => {
    let section = "no Disconnect button (no agents connected)"
    const result = await run(
      (step) => {
        if (step.results.length === 0) return navigate(localOrigin)
        if (step.results.length === 1) {
          return (async () => {
            await panel.evaluate(() => {
              const api = (globalThis as unknown as { chrome: { runtime: { sendMessage: (...args: unknown[]) => Promise<unknown> } } }).chrome
              Object.defineProperty(api.runtime, "sendMessage", { configurable: true, value: () => Promise.reject(new Error("Receiving end does not exist.")) })
            })
            // The row renders after the session opens; wait for it, or the check would read the placeholder.
            const button = panel.getByRole("button", { name: /^Disconnect / })
            const shown = await button.waitFor({ timeout: 10_000 }).then(
              () => true,
              () => false,
            )
            expect(shown, `settings-faults: no Disconnect button appeared during the live run: ${await sectionText()}`)
            if (shown) {
              await button.click()
              await Bun.sleep(500)
              section = await sectionText()
            }
            await shot("02-command-rejected")
            return undefined
          })()
        }
        return undefined
      },
      {},
      { hub, keepHub: true },
    ).catch((error: unknown) => ({ error: String(error) }))
    return { section, result: "error" in result ? result.error : result.last.results.map((text) => text.slice(0, 200)) }
  })()
  expectKnown(
    "settings-faults:disconnect-text",
    String(field(out["command-rejected"], "section")).includes("Couldn't disconnect the agent. Try again."),
    `a Disconnect nothing answered shows no Disconnect error: ${String(field(out["command-rejected"], "section"))}`,
  )
  await panel.reload()
  await openSettings()

  // Save fails: storage.local.set rejects for the switch's write.
  await panel.evaluate(() => {
    const api = (globalThis as unknown as { chrome: { storage: { local: { set: (...args: unknown[]) => Promise<unknown> } } } }).chrome
    const original = api.storage.local.set.bind(api.storage.local)
    Object.defineProperty(api.storage.local, "set", {
      configurable: true,
      value: (items: Record<string, unknown>, ...rest: unknown[]) =>
        "kiloLocalAgentSettings" in items ? Promise.reject(new Error("QUOTA_BYTES quota exceeded")) : original(items, ...rest),
    })
  })
  await toggle().click()
  await Bun.sleep(1_000)
  out["save-failed"] = { section: await sectionText(), switchOn: await switchState() }
  await shot("03-save-failed")
  await panel.reload()
  await openSettings()

  // Load fails: storage reads reject on the next refresh.
  await panel.evaluate(() => {
    const api = (globalThis as unknown as { chrome: { storage: { session: { get: (...args: unknown[]) => Promise<unknown> } } } }).chrome
    Object.defineProperty(api.storage.session, "get", { configurable: true, value: () => Promise.reject(new Error("storage unavailable")) })
  })
  // A status write from the worker triggers the page's refresh.
  await hub.stop()
  await Bun.sleep(3_000)
  out["load-failed"] = { section: await sectionText() }
  await shot("04-load-failed")
  await panel.reload()
  await openSettings()
  return out
}

// ---------------------------------------------------------------------------------------------
// Scenario: local agents and the Kilo account (SPEC D15: no sign-in is needed for local agents).
// ---------------------------------------------------------------------------------------------

async function pageText() {
  return (await panel.locator("body").innerText().catch(() => "")).replace(/\n+/g, " | ")
}

async function localStorageState() {
  const local = record(await worker.evaluate(() => chrome.storage.local.get(null))) ?? {}
  return {
    endpoints: Array.isArray(local["kiloLocalAgentEndpoints"]) ? local["kiloLocalAgentEndpoints"].length : (local["kiloLocalAgentEndpoints"] ?? null),
    keys: Object.keys(local),
    settings: local["kiloLocalAgentSettings"] ?? null,
  }
}

async function pageShot(name: string) {
  await fs.mkdir(evidence, { recursive: true })
  const file = path.join(evidence, `${scenarioLabel}-${name}.page.png`)
  await panel.bringToFront()
  await panel.screenshot({ path: file, fullPage: true })
  shots.push(file)
  await screen(name)
}

/** The storage.local keys an account run saw after its change. */
function localKeysAfter(result: Record<string, unknown> | undefined): string[] {
  const keys = field(field(result?.["after"], "local"), "keys")
  return Array.isArray(keys) ? keys.map(String) : []
}

/** One live run; between its second and third call `change` alters the account state, and the model's next texts are kept. */
async function accountRun(label: string, change: () => Promise<void>) {
  scenarioLabel = `account-${label}`
  const out: Record<string, unknown> = {}
  const result = await run(
    (step) => {
      if (step.results.length === 0) return navigate(localOrigin)
      if (step.results.length === 1) return snapshot
      if (step.results.length === 2) {
        return (async () => {
          out["before"] = { groups: (await tabState()).groups, local: await localStorageState() }
          await change()
          await Bun.sleep(3_000)
          out["after"] = {
            groups: (await tabState()).groups,
            local: await localStorageState(),
            page: (await pageText()).slice(0, 600),
            session: await sessionStorage(),
          }
          await pageShot("01-after-change")
          return snapshot
        })()
      }
      if (step.results.length === 3) return navigate(`${localOrigin}/?after=${label}`)
      return undefined
    },
    {},
    { label },
  )
  out["next"] = result.last.results[2] ?? null
  out["afterNext"] = result.last.results[3] ?? null
  out["code"] = result.code
  return out
}

async function signedOutScenario() {
  scenarioLabel = "account-signed-out"
  const out: Record<string, unknown> = {}

  // (1) A signed-out user reaches the switch through the header's Settings entry, pairs and runs an agent.
  await panel.getByText("Sign in to continue").waitFor()
  const settingsButton = panel.getByRole("button", { name: "Settings" })
  const settingsShown = await settingsButton.waitFor({ timeout: 5_000 }).then(
    () => true,
    () => false,
  )
  await pageShot("01-signed-out-panel")
  const manifest = JSON.parse(await fs.readFile(path.join(extensionDirectory, "manifest.json"), "utf8")) as Record<string, unknown>
  out["other-surfaces"] = { action: manifest["action"] ?? null, options_page: manifest["options_page"] ?? null, options_ui: manifest["options_ui"] ?? null }
  if (!settingsShown) {
    // Without a way into the settings nothing else in this scenario can run.
    out["signed-out"] = { page: await pageText(), settingsButtons: 0, switches: 0, url: panel.url() }
    expect(false, `signed out, the "Allow local agents" switch is unreachable (SPEC D15): no Settings button; ${String(record(out["signed-out"])?.["page"]).slice(0, 300)}`)
    return out
  }
  await openSettings()
  const switches = await toggle().count()
  out["signed-out"] = { page: await pageText(), settingsButtons: 1, switches, url: panel.url() }
  await pageShot("02-signed-out-settings")
  expect(switches > 0, `signed out, the "Allow local agents" switch is unreachable (SPEC D15): ${String(record(out["signed-out"])?.["page"]).slice(0, 300)}`)
  await setSwitch(true)
  await pageShot("03-signed-out-switch-on")
  out["signed-out-run"] = await accountRun("signed-out-run", async () => {})
  const signedOutRun = record(out["signed-out-run"])
  expect(
    signedOutRun?.["code"] === 0 && !/stopped|not available/.test(String(signedOutRun?.["next"])),
    `signed out, pairing and a local agent run failed (SPEC D15): ${String(signedOutRun?.["next"]).slice(0, 200)}`,
  )
  scenarioLabel = "account-signed-out"

  // (2) Signed in, switch on, agent running; then Sign out from the settings.
  await signIn()
  await setSwitch(true)
  out["sign-out-mid-run"] = await accountRun("sign-out", async () => {
    await openSettings()
    await panel.getByRole("button", { name: "Sign out" }).click()
  })
  const signOut = record(out["sign-out-mid-run"])
  expect(
    !String(signOut?.["next"]).includes("stopped"),
    `signing out of the Kilo account stopped the local agent (SPEC D15): ${String(signOut?.["next"]).slice(0, 200)}; local after: ${JSON.stringify(field(signOut?.["after"], "local"))}`,
  )
  const signOutKeys = localKeysAfter(signOut)
  expect(
    signOutKeys.includes("kiloLocalAgentSettings") && signOutKeys.includes("kiloLocalAgentEndpoints") && !signOutKeys.includes("kiloAuth"),
    `sign-out must keep the local-agent keys and remove the account token: ${JSON.stringify(signOutKeys)}`,
  )

  // (3) The token expires (the page validates on load and gets 401) while an agent runs.
  await signIn()
  await setSwitch(true)
  out["token-expired-mid-run"] = await accountRun("token-expired", async () => {
    apiUserStatus = 401
    await panel.reload()
  })
  apiUserStatus = 200
  const expired = record(out["token-expired-mid-run"])
  expect(
    !String(expired?.["next"]).includes("stopped"),
    `an expired Kilo token stopped the local agent (SPEC D15): ${String(expired?.["next"]).slice(0, 200)}; local after: ${JSON.stringify(field(expired?.["after"], "local"))}`,
  )
  const expiredKeys = localKeysAfter(expired)
  expect(
    expiredKeys.includes("kiloLocalAgentSettings") && expiredKeys.includes("kiloLocalAgentEndpoints") && !expiredKeys.includes("kiloAuth"),
    `token expiry must keep the local-agent keys and remove the account token: ${JSON.stringify(expiredKeys)}`,
  )

  // (4) The token check fails (500): the validation error view with an agent running.
  await signIn()
  await setSwitch(true)
  out["validation-error-mid-run"] = await accountRun("validation-error", async () => {
    apiUserStatus = 500
    await panel.reload()
  })
  apiUserStatus = 200
  const failed = record(out["validation-error-mid-run"])
  observe(
    !String(failed?.["next"]).includes("stopped"),
    `a failed token check stopped the local agent: ${String(failed?.["next"]).slice(0, 200)}`,
  )
  await signIn()
  await setSwitch(true)
  return out
}

// ---------------------------------------------------------------------------------------------
// Scenario: Stop all while a second conversation of the same CLI is mid-turn without a browser session yet.
// One `kilo2 serve` process holds both conversations, so the revoke for the first one reaches the CLI that runs the
// second. Conversation A opens a session and finishes its turn; conversation B starts a turn, the user presses Stop all
// before B's first browser call, and B's call must not open a new group. B's next user message starts a normal turn.
// ---------------------------------------------------------------------------------------------

async function startServe(root: string) {
  const port = await freePort()
  const password = crypto.randomUUID()
  const log = { text: "" }
  const child = Bun.spawn([binary, "serve", "--port", String(port)], {
    cwd: root,
    env: {
      ...environment(root, {}),
      KILO_PASSWORD: password,
      KILO_SERVER_PASSWORD: password,
      OPENCODE_PASSWORD: password,
      OPENCODE_SERVER_PASSWORD: password,
    },
    stderr: "pipe",
    stdout: "pipe",
  })
  tap(child.stdout as ReadableStream<Uint8Array>, log)
  tap(child.stderr as ReadableStream<Uint8Array>, log)
  const origin = `http://127.0.0.1:${port}`
  // The server's Basic-auth user is the branded binary name; try both names once the port answers.
  const user = await until(
    async () => {
      for (const name of ["kilo", "opencode"]) {
        const response = await fetch(`${origin}/api/session`, {
          headers: { authorization: `Basic ${Buffer.from(`${name}:${password}`).toString("base64")}` },
        }).catch(() => undefined)
        if (response?.ok) return name
      }
      return undefined
    },
    60_000,
    `kilo2 serve answers on ${origin}`,
  ).catch(async (error: unknown) => {
    await terminate(child)
    throw new Error(`${String(error)}; serve log: ${log.text.slice(-1_500)}`)
  })
  const authorization = `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`
  const api = async (method: string, pathname: string, body?: unknown) => {
    const response = await fetch(`${origin}${pathname}`, {
      method,
      headers: { authorization, ...(body === undefined ? {} : { "content-type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    const text = await response.text()
    if (!response.ok) throw new Error(`${method} ${pathname} → ${response.status}: ${text.slice(0, 600)}`)
    return text === "" ? undefined : (JSON.parse(text) as unknown)
  }
  return {
    api,
    log,
    stop: () => terminate(child),
  }
}

async function stopRaceScenario() {
  scenarioLabel = "stop-race"
  await setSwitch(true)
  const out: Record<string, unknown> = {}
  const root = await freshRoot("stop-race")
  const hub = await startHub(root, {})
  let serve: Awaited<ReturnType<typeof startServe>> | undefined
  try {
    await pair(hub)
    serve = await startServe(root)
    const { api } = serve
    const create = async () => {
      const created = await api("POST", "/api/session", { model: { id: "echo", providerID: "local" } })
      const id = field(field(created, "data"), "id")
      if (typeof id !== "string") throw new Error(`session.create returned no id: ${JSON.stringify(created)}`)
      return id
    }
    /** One user message to a conversation and the tool results of its turn, after the model's final answer. */
    const turn = async (session: string, plan: Plan) => {
      history.length = 0
      const finished = Promise.withResolvers<void>()
      model.plan = async (step) => {
        const next = await plan(step)
        if (next === undefined) finished.resolve()
        return next
      }
      await api("POST", `/api/session/${session}/prompt`, { text: "Check the browser bridge." })
      const timer = setTimeout(() => finished.reject(new Error(`the turn of ${session} did not finish`)), 120_000)
      await finished.promise.finally(() => clearTimeout(timer))
      await api("POST", `/api/experimental/session/${session}/wait`)
      model.plan = undefined
      return history.at(-1)?.results ?? []
    }
    const first = await create()
    const second = await create()

    // A: opens its browser session; its turn ends, the session stays open.
    const a = await turn(first, (step) => (step.results.length === 0 ? navigate(localOrigin) : undefined))
    out["a"] = a.map((text) => text.slice(0, 200))
    const groupsAfterA = (await tabState()).groups
    out["groupsAfterA"] = groupsAfterA
    expect(liveGroup(groupsAfterA) !== undefined, `conversation A opened no tab group: ${JSON.stringify(groupsAfterA)}`)
    await shot("01-a-open")

    // B: mid-turn, before its first browser call, the user presses Stop all.
    const b = await turn(second, (step) => {
      if (step.results.length > 0) return undefined
      return (async () => {
        await panel.getByRole("button", { name: "Stop all" }).click()
        out["groupsAtStop"] = await until(
          async () => {
            const groups = (await tabState()).groups
            return liveGroup(groups) === undefined ? groups : undefined
          },
          10_000,
          "Stop all ends A's group",
        )
        return navigate(`${localOrigin}/?after=stop-race`)
      })()
    })
    out["b"] = b.map((text) => text.slice(0, 300))
    const groupsAfterB = (await tabState()).groups
    out["groupsAfterB"] = groupsAfterB
    out["sectionAfterB"] = await sectionText()
    expect(
      (b[0] ?? "").includes("The user stopped this browser session") && liveGroup(groupsAfterB) === undefined,
      `a turn running at Stop all opened a new session: result=${(b[0] ?? "").slice(0, 200)}; groups=${JSON.stringify(groupsAfterB)}`,
    )
    await shot("02-b-stopped")

    // B's next user message is a new turn: the stop no longer applies to it.
    const again = await turn(second, (step) => (step.results.length === 1 ? navigate(`${localOrigin}/?after=next-turn`) : undefined))
    out["bNextTurn"] = again.map((text) => text.slice(0, 300))
    const groupsAfterNext = (await tabState()).groups
    out["groupsAfterNextTurn"] = groupsAfterNext
    const nextResult = again.at(-1) ?? ""
    expect(
      nextResult.includes("after=next-turn") && !nextResult.includes("stopped") && liveGroup(groupsAfterNext) !== undefined,
      `B's next turn could not use the browser: result=${nextResult.slice(0, 200)}; groups=${JSON.stringify(groupsAfterNext)}`,
    )
    await shot("03-b-next-turn")
  } finally {
    out["serveLog"] = serve?.log.text.slice(-800)
    await serve?.stop()
    await hub.stop()
  }
  return out
}

// ---------------------------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------------------------

const scenarios: Record<string, () => Promise<Record<string, unknown>>> = {
  controls: controlsScenario,
  errors: errorsScenario,
  pairing: pairingScenario,
  "settings-faults": settingsFaultsScenario,
  "share-adopt": shareAdoptScenario,
  "signed-out": signedOutScenario,
  "stop-race": stopRaceScenario,
  tui: tuiScenario,
  "tui-redirect": async () => {
    await setSwitch(true)
    return { redirect: await tuiRedirect() }
  },
  all: async () => ({
    pairing: await pairingScenario(),
    controls: await controlsScenario(),
    errors: await errorsScenario(),
    tui: await tuiScenario(),
    settingsFaults: await settingsFaultsScenario(),
  }),
}

const selected = scenarios[scenario]
if (!selected) throw new Error(`unknown scenario ${scenario}; choose ${Object.keys(scenarios).join(", ")}`)

const knownFailure = KNOWN_FAILURES[scenario]
const strict = process.argv.includes("--strict")

/**
 * The run's status and exit code. Failures that are all among the known scenario's expected messages, or misses of
 * known checks, are `known-fail` (exit 0, or 1 with `--strict`); any other failure, a harness error included, is `FAIL`
 * (exit 1); a known scenario or known check that passes is an `UNEXPECTED PASS` (exit 0).
 */
function finish() {
  const expected = knownFailure?.failures ?? []
  const unexpected = failures.some((failure) => !expected.some((pattern) => pattern.test(failure)))
  const status = unexpected
    ? "FAIL"
    : failures.length > 0 || knownChecks.some((item) => !item.passed)
      ? "known-fail"
      : knownFailure !== undefined || knownChecks.length > 0
        ? "UNEXPECTED PASS"
        : "pass"
  if (status === "FAIL" || (status === "known-fail" && strict)) process.exitCode = 1
  return status
}

base = process.env.E2E_HOME ?? (await fs.mkdtemp(path.join(os.tmpdir(), "bridge-ux-")))
await fs.mkdir(base, { recursive: true })
evidence = process.env.E2E_EVIDENCE ?? path.join(base, "evidence")

function report(results: Record<string, unknown>) {
  const status = finish()
  return {
    chromium: launched?.executable,
    evidence: shots,
    extension: loadedExtension,
    extensionId,
    failures,
    ...(knownFailure === undefined ? {} : { knownFailure: knownFailure.reason }),
    knownChecks,
    observations,
    scenario,
    status,
    ...results,
  }
}

try {
  await launch()
  // The account scenario starts signed out, with no seeded token: it reaches the settings by signing in itself.
  await openPanel(scenario !== "signed-out")
  const results = await selected()
  console.log(JSON.stringify(report({ results }), null, 2))
} catch (error) {
  failures.push(`harness: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`)
  console.log(JSON.stringify(report({}), null, 2))
} finally {
  await launched?.close().catch(() => undefined)
  fixture.stop(true)
  frame.stop(true)
  model.stop()
}
