/**
 * OnboardingWizard — first-run setup for KiloCode MAOS Edition.
 *
 * Goal: a brand-new user is fully configured in under 2 minutes by
 * answering at most 5 questions. Everything else is auto-detected
 * (Hub URL probe, env vars, ~/.kilocode/secrets.json import, Hermes
 * DNS resolution).
 *
 * UX contract (per HUB_OTA_UPDATE_SPEC §4.4 + HUB_SEAMLESS_INTEGRATION):
 *   1. "DaveAI Hub or Standalone?"      → infers all Hub URLs
 *   2. "Update mode?"                   → off / prompt / silent
 *   3. "Update channel?"                → stable / canary / dev
 *   4. "Got a MiniMax key?"             → SecretStorage import
 *   5. "Preferred coding model?"        → routing default
 *
 * No external runtime deps — only vscode API + stdlib http(s).
 */
import * as vscode from "vscode"
import * as https from "https"
import * as http from "http"
import * as fs from "fs"
import * as os from "os"
import * as path from "path"
import { URL } from "url"

export type DeploymentMode = "hub" | "standalone"
export type UpdateChannel = "stable" | "canary" | "dev"
export type UpdateMode = "off" | "prompt" | "silent"
export type PreferredModel = "claude" | "minimax" | "multi"

export interface DetectionResults {
  hubReachable: boolean
  hubBaseUrl: string | null
  localHubReachable: boolean
  envKeysFound: { minimax: boolean; anthropic: boolean; hf: boolean }
  legacySecretsFound: boolean
  hermesDnsOk: boolean
}

export interface OnboardingResult {
  mode: DeploymentMode
  hubBaseUrl: string | null
  updateMode: UpdateMode
  updateChannel: UpdateChannel
  minimaxConfigured: boolean
  preferredModel: PreferredModel
  completedAt: string
}

export interface ConnectionTestResults {
  services: Array<{ name: string; url: string; ok: boolean; error?: string }>
  allOk: boolean
}

const HUB_PROBE_TIMEOUT_MS = 4_000
const HUB_HEALTH_PATH = "/api/hub/health"
const REMOTE_HUB_URL = "https://hermes.daveai.tech"
const LOCAL_HUB_URL = "http://localhost:8095"

const SECRET_KEY = {
  minimax: "daveai.minimax.apiKey",
  anthropic: "daveai.anthropic.apiKey",
  hf: "daveai.hf.token",
} as const

interface PickItem<V> extends vscode.QuickPickItem { value: V }

export class OnboardingWizard {
  constructor(private readonly context: vscode.ExtensionContext) {}

  /** Auto-detect everything we can BEFORE asking the user anything. */
  async runDetection(): Promise<DetectionResults> {
    const [hubReachable, localHubReachable, hermesDnsOk] = await Promise.all([
      this.probe(`${REMOTE_HUB_URL}${HUB_HEALTH_PATH}`),
      this.probe(`${LOCAL_HUB_URL}${HUB_HEALTH_PATH}`),
      this.resolves(REMOTE_HUB_URL),
    ])
    const env = process.env ?? {}
    const envKeysFound = {
      minimax: Boolean(env.MINIMAX_API_KEY),
      anthropic: Boolean(env.ANTHROPIC_API_KEY),
      hf: Boolean(env.HF_TOKEN),
    }
    const legacySecretsFound = fs.existsSync(
      path.join(os.homedir(), ".kilocode", "secrets.json"),
    )
    return {
      hubReachable, localHubReachable, hermesDnsOk, envKeysFound, legacySecretsFound,
      hubBaseUrl: hubReachable ? REMOTE_HUB_URL : localHubReachable ? LOCAL_HUB_URL : null,
    }
  }

  /** Import secrets from env + ~/.kilocode/secrets.json into SecretStorage. */
  async importSecrets(detection: DetectionResults): Promise<void> {
    const env = process.env ?? {}
    const pairs: Array<[string, string | undefined]> = [
      [SECRET_KEY.minimax, detection.envKeysFound.minimax ? env.MINIMAX_API_KEY : undefined],
      [SECRET_KEY.anthropic, detection.envKeysFound.anthropic ? env.ANTHROPIC_API_KEY : undefined],
      [SECRET_KEY.hf, detection.envKeysFound.hf ? env.HF_TOKEN : undefined],
    ]
    for (const [k, v] of pairs) if (v) await this.context.secrets.store(k, v)

    if (detection.legacySecretsFound) {
      try {
        const raw = fs.readFileSync(
          path.join(os.homedir(), ".kilocode", "secrets.json"), "utf8",
        )
        const parsed = JSON.parse(raw) as Record<string, string>
        const legacy: Array<[string, string | undefined]> = [
          [SECRET_KEY.minimax, parsed.MINIMAX_API_KEY],
          [SECRET_KEY.anthropic, parsed.ANTHROPIC_API_KEY],
          [SECRET_KEY.hf, parsed.HF_TOKEN],
        ]
        for (const [k, v] of legacy) if (v) await this.context.secrets.store(k, v)
      } catch { /* best-effort */ }
    }
  }

  /** Drive the 5-question wizard. Returns null if the user cancels. */
  async runWizard(detection: DetectionResults): Promise<OnboardingResult | null> {
    const hubDesc = detection.hubReachable
      ? "hermes.daveai.tech detected"
      : detection.localHubReachable ? "localhost:8095 detected" : "Will retry later"

    const mode = await this.pick<DeploymentMode>(
      "Welcome to KiloCode MAOS Edition (1/5)",
      "How are you running KiloCode?",
      [
        { label: "DaveAI Hub (recommended)", description: hubDesc, value: "hub" },
        { label: "Standalone", description: "No central Hub, local-only models", value: "standalone" },
      ],
    )
    if (!mode) return null

    const updateMode = await this.pick<UpdateMode>(
      "Update behaviour (2/5)", "How should KiloCode handle updates?",
      [
        { label: "Ask before each update (recommended)", value: "prompt" },
        { label: "Auto-update silently", value: "silent" },
        { label: "Off — I'll update manually", value: "off" },
      ],
    )
    if (!updateMode) return null

    const updateChannel = await this.pick<UpdateChannel>(
      "Update channel (3/5)", "Pick your release channel",
      [
        { label: "Stable (recommended)", value: "stable" },
        { label: "Canary (early access, ~10% cohort)", value: "canary" },
        { label: "Dev (bleeding edge, builders only)", value: "dev" },
      ],
    )
    if (!updateChannel) return null

    let minimaxConfigured = detection.envKeysFound.minimax
    if (!minimaxConfigured) {
      const keyAction = await this.pick<"paste" | "later" | "help">(
        "MiniMax API key (4/5)", "MiniMax M2.7 is included in the $80/yr DaveAI plan",
        [
          { label: "Yes, paste it now", value: "paste" },
          { label: "I'll add it later", value: "later" },
          { label: "I don't have one yet — show me how", value: "help" },
        ],
      )
      if (!keyAction) return null

      if (keyAction === "paste") {
        const key = await vscode.window.showInputBox({
          title: "Paste your MiniMax API key",
          password: true, ignoreFocusOut: true,
          placeHolder: "MiniMax key (stored in VS Code SecretStorage)",
          validateInput: (v) => v.trim().length < 8 ? "Key looks too short" : null,
        })
        if (key && key.trim()) {
          await this.context.secrets.store(SECRET_KEY.minimax, key.trim())
          minimaxConfigured = true
        }
      } else if (keyAction === "help") {
        void vscode.env.openExternal(
          vscode.Uri.parse("https://hermes.daveai.tech/hub#minimax-signup"),
        )
      }
    }

    const preferredModel = await this.pick<PreferredModel>(
      "Default coding model (5/5)",
      "Which model should drive your daily coding sessions?",
      [
        { label: "Claude Sonnet 4.6 (best for code)", value: "claude" },
        { label: "MiniMax M2.7 (best for cost)", value: "minimax" },
        { label: "Multi-model (auto-route via Hermes)", value: "multi" },
      ],
    )
    if (!preferredModel) return null

    return {
      mode, updateMode, updateChannel, minimaxConfigured, preferredModel,
      hubBaseUrl: mode === "hub" ? detection.hubBaseUrl : null,
      completedAt: new Date().toISOString(),
    }
  }

  /** Verify URLs the wizard configured. Auto-retry failures once. */
  async testConnections(result: OnboardingResult): Promise<ConnectionTestResults> {
    const targets: Array<{ name: string; url: string }> = []
    if (result.hubBaseUrl) {
      targets.push(
        { name: "Hub health", url: `${result.hubBaseUrl}${HUB_HEALTH_PATH}` },
        { name: "Update manifest", url: `${result.hubBaseUrl}/api/updates/manifest?channel=${result.updateChannel}` },
        { name: "Bootstrap config", url: `${result.hubBaseUrl}/api/bootstrap` },
      )
    }
    const services = await Promise.all(targets.map(async (t) => {
      const first = await this.probeWithError(t.url)
      if (first.ok) return { name: t.name, url: t.url, ok: true }
      const retry = await this.probeWithError(t.url)
      return retry.ok
        ? { name: t.name, url: t.url, ok: true }
        : { name: t.name, url: t.url, ok: false, error: retry.error }
    }))
    return { services, allOk: services.every((s) => s.ok) }
  }

  // ─── Private helpers ─────────────────────────────────────

  private async pick<V>(
    title: string, placeHolder: string, items: PickItem<V>[],
  ): Promise<V | undefined> {
    const chosen = await vscode.window.showQuickPick(items, {
      title, placeHolder, ignoreFocusOut: true,
    })
    return chosen ? (chosen as PickItem<V>).value : undefined
  }

  private async probe(url: string): Promise<boolean> {
    return (await this.probeWithError(url)).ok
  }

  private async probeWithError(url: string): Promise<{ ok: boolean; error?: string }> {
    return new Promise((resolve) => {
      try {
        const u = new URL(url)
        const lib = u.protocol === "https:" ? https : http
        const req = lib.get(
          url,
          { timeout: HUB_PROBE_TIMEOUT_MS, headers: { accept: "application/json" } },
          (res) => {
            const code = res.statusCode ?? 0
            res.resume()
            resolve({ ok: code >= 200 && code < 400, error: code ? `HTTP ${code}` : undefined })
          },
        )
        req.on("timeout", () => { req.destroy(); resolve({ ok: false, error: "timeout" }) })
        req.on("error", (err) => resolve({ ok: false, error: err.message }))
      } catch (err) {
        resolve({ ok: false, error: err instanceof Error ? err.message : String(err) })
      }
    })
  }

  private async resolves(url: string): Promise<boolean> {
    try {
      const u = new URL(url)
      const dns = await import("dns")
      return await new Promise<boolean>((res) => {
        dns.lookup(u.hostname, (err) => res(!err))
      })
    } catch { return false }
  }
}
