// kilocode_change - new file
import { execFile } from "child_process"
import type { AuthOAuthResult } from "@kilocode/plugin"

interface DeviceCodeResponse {
  readonly device_code: string
  readonly user_code: string
  readonly verification_uri: string
  readonly verification_uri_complete: string
  readonly expires_in: number
  readonly interval: number
}

interface TokenSuccess {
  readonly api_key: string
  readonly project_id?: string
  readonly name?: string
}

export interface LlmapiDeviceAuthOptions {
  /** Management API base, e.g. "https://api.llmapi.ai". */
  readonly apiBaseURL?: string
  readonly fetchImpl?: typeof fetch
  readonly openBrowser?: (url: string) => void
  readonly pollIntervalMs?: number
}

const DEFAULT_API_BASE = "https://api.llmapi.ai"

function defaultOpenBrowser(url: string): void {
  const [cmd, ...args] =
    process.platform === "darwin"
      ? ["open", url]
      : process.platform === "win32"
        ? ["cmd", "/c", "start", "", url]
        : ["xdg-open", url]
  execFile(cmd, args, { windowsHide: true }, () => {})
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * RFC 8628 device-authorization flow against the LLMAPI management API.
 *
 * Returns the URL + instructions to display and an `auto` callback that polls
 * `/auth/device/token` until the backend mints an API key (success), or the user
 * denies / the code expires (failure).
 */
export async function authenticateWithLlmapiDeviceAuth(
  options: LlmapiDeviceAuthOptions = {},
): Promise<AuthOAuthResult> {
  const apiBase = (options.apiBaseURL ?? process.env.LLMAPI_API_URL ?? DEFAULT_API_BASE).replace(/\/+$/, "")
  const doFetch = options.fetchImpl ?? fetch
  const openBrowser = options.openBrowser ?? defaultOpenBrowser

  const codeResp = await doFetch(`${apiBase}/auth/device/code`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: "kilo-code" }),
  })
  if (!codeResp.ok) throw new Error(`Failed to start LLMAPI sign-in: ${codeResp.status}`)
  const data = (await codeResp.json()) as DeviceCodeResponse

  openBrowser(data.verification_uri_complete)

  const intervalMs = options.pollIntervalMs ?? Math.max(data.interval, 1) * 1000
  const deadline = Date.now() + data.expires_in * 1000

  return {
    url: data.verification_uri_complete,
    instructions: `Open ${data.verification_uri} and enter code: ${data.user_code}`,
    method: "auto",
    async callback() {
      let wait = intervalMs
      while (Date.now() < deadline) {
        await delay(wait)
        const resp = await doFetch(`${apiBase}/auth/device/token`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            device_code: data.device_code,
            grant_type: "urn:ietf:params:oauth:grant-type:device_code",
          }),
        })

        if (resp.ok) {
          const ok = (await resp.json()) as TokenSuccess
          if (ok.api_key) return { type: "success", key: ok.api_key }
          return { type: "failed" }
        }

        const err = (await resp.json().catch(() => ({}))) as { error?: string }
        if (err.error === "authorization_pending") continue
        if (err.error === "slow_down") {
          wait += 5000
          continue
        }
        // access_denied, expired_token, or anything unexpected → stop.
        return { type: "failed" }
      }
      return { type: "failed" }
    },
  }
}
