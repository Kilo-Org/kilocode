import type * as vscode from "vscode"
import { HERMES_DEFAULT_BASE_URL, HERMES_SECRET_KEY } from "./types"

/**
 * The "Hermes" LLM provider preset (Option A half of D1 decision).
 *
 * KiloCode's CLI backend reads Custom Providers from config. When the Hermes
 * pipeline toggle is ON, we register a preset pointing at the Hermes Bridge
 * base URL. Hermes exposes an OpenAI-compatible /v1/chat/completions surface
 * that transparently routes to Claude / MiniMax / SiliconFlow / etc.
 *
 * The preset is ephemeral: when the toggle is OFF the preset is removed, so
 * stale entries never appear in the Providers tab.
 *
 * NOTE: actual persistence is delegated to the CLI backend via the regular
 * `updateConfig` message — this file only builds the preset object and defines
 * the identifiers. Integrating it into config writes is the caller's job.
 */

export const HERMES_PROVIDER_ID = "hermes"

/** The shape stored in config.provider[HERMES_PROVIDER_ID]. */
export interface HermesProviderPreset {
  npm: "@ai-sdk/openai-compatible"
  name: "Hermes"
  env: [string]
  options: {
    baseURL: string
    headers: { "x-kilo-source": "kilo-vscode" }
  }
  models: {
    "hermes-auto": { name: "Hermes (auto-routed)" }
    "claude-sonnet-4-5": { name: "Claude Sonnet 4.5 (via Hermes)" }
    "MiniMax-M2.7": { name: "MiniMax M2.7 (via Hermes)" }
    "deepseek-ai/DeepSeek-V3": { name: "DeepSeek V3 (via Hermes)" }
  }
}

/**
 * Build the provider preset for the given Bridge URL.
 * `baseUrl` must be the OpenAI-compatible root — we append `/v1`.
 */
export function buildPreset(baseUrl: string = HERMES_DEFAULT_BASE_URL): HermesProviderPreset {
  const root = baseUrl.replace(/\/+$/, "")
  return {
    npm: "@ai-sdk/openai-compatible",
    name: "Hermes",
    env: [HERMES_SECRET_KEY],
    options: {
      baseURL: `${root}/v1`,
      headers: { "x-kilo-source": "kilo-vscode" },
    },
    models: {
      "hermes-auto": { name: "Hermes (auto-routed)" },
      "claude-sonnet-4-5": { name: "Claude Sonnet 4.5 (via Hermes)" },
      "MiniMax-M2.7": { name: "MiniMax M2.7 (via Hermes)" },
      "deepseek-ai/DeepSeek-V3": { name: "DeepSeek V3 (via Hermes)" },
    },
  }
}

/**
 * Given a VS Code context and pipeline state, return the provider entry to
 * merge into config, or `null` to signal "remove this provider entirely".
 *
 * The caller is responsible for actually writing to config via
 * `webview → updateConfig` or the CLI SDK.
 */
export function presetForState(
  _ctx: vscode.ExtensionContext,
  enabled: boolean,
  baseUrl: string,
): HermesProviderPreset | null {
  if (!enabled) return null
  return buildPreset(baseUrl)
}
