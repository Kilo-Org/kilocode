// @ts-ignore: openclaw peer dep provided by the gateway at runtime
import { resolveFetch } from "openclaw/plugin-sdk/fetch-runtime"; // eslint-disable-line import/no-unresolved
import type { PluginLogger } from "./token-store.js";

/**
 * How long a single poll call is willing to block the tool handler. We
 * keep this well under any reasonable LLM/gateway tool-execution budget.
 * The happy path (user approved in their browser before calling back to
 * the plugin) typically resolves in one poll interval (3s); the rest of
 * this window is grace for slow approvals. If we hit the deadline
 * without a terminal state from the server, we return "timeout" and the
 * caller keeps the pending code in place so a subsequent invocation can
 * keep polling.
 */
const POLL_TIMEOUT_MS = 30 * 1_000;
const POLL_INTERVAL_MS = 3_000;

type DeviceAuthInitResponse = {
  code: string;
  verificationUrl: string;
  expiresIn: number;
};

type DeviceAuthPollResponse =
  | { status: "pending" }
  | { status: "approved"; token: string; userId: string; userEmail: string }
  | { status: "denied" }
  | { status: "expired" };

export type DeviceAuthStartResult = {
  kind: "started";
  code: string;
  verificationUrl: string;
  expiresIn: number;
};

/**
 * Poll result kinds:
 * - approved: server returned approval + token. Ready to run the checkup.
 * - denied:   user explicitly denied in the browser. Clear pending code.
 * - expired:  server-reported 410 Gone or server-reported expired status.
 *             The device-auth code itself is dead. Clear pending code.
 * - timeout:  we hit our local POLL_TIMEOUT_MS deadline while the server
 *             was still returning pending. The code may still be valid
 *             server-side; caller should NOT clear pending code so the
 *             next invocation can keep polling.
 */
export type DeviceAuthPollResult =
  | { kind: "approved"; token: string }
  | { kind: "pending" }
  | { kind: "denied" }
  | { kind: "expired" }
  | { kind: "timeout" };

/**
 * Create a device auth request and return the code + URL for the user to visit.
 * Call this once, show the result to the user, then poll with pollDeviceAuth().
 */
export async function startDeviceAuth(apiBase: string): Promise<DeviceAuthStartResult> {
  const fetchFn: typeof fetch = resolveFetch() ?? globalThis.fetch;
  const resp = await fetchFn(`${apiBase}/api/device-auth/codes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
  if (!resp.ok) {
    throw new Error(`Failed to start KiloCode authentication (HTTP ${resp.status})`);
  }
  const data = (await resp.json()) as DeviceAuthInitResponse;
  return {
    kind: "started",
    code: data.code,
    verificationUrl: data.verificationUrl,
    expiresIn: data.expiresIn,
  };
}

/**
 * Poll a device auth code until it resolves (approved/denied/expired),
 * or until the local POLL_TIMEOUT_MS deadline is hit (returns "timeout").
 * Server-reported 410 Gone returns "expired". Transient network errors
 * during polling are logged at debug level and the loop continues until
 * the deadline.
 */
export async function pollDeviceAuth(
  apiBase: string,
  code: string,
  logger?: PluginLogger,
): Promise<DeviceAuthPollResult> {
  const fetchFn: typeof fetch = resolveFetch() ?? globalThis.fetch;
  const pollUrl = `${apiBase}/api/device-auth/codes/${code}`;
  const deadline = Date.now() + POLL_TIMEOUT_MS;

  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);
    try {
      const resp = await fetchFn(pollUrl);
      if (resp.status === 202) continue; // pending
      if (resp.status === 403) return { kind: "denied" };
      if (resp.status === 410) return { kind: "expired" };
      if (resp.ok) {
        const data = (await resp.json()) as DeviceAuthPollResponse;
        if (data.status === "approved") return { kind: "approved", token: data.token };
        if (data.status === "denied") return { kind: "denied" };
        if (data.status === "expired") return { kind: "expired" };
      }
    } catch (err) {
      // Transient network error. Log at debug level so it's visible
      // when investigating real failures but not noisy on the happy path.
      const message = err instanceof Error ? err.message : String(err);
      logger?.debug?.(`security-advisor: poll transient error: ${message}`);
    }
  }

  return { kind: "timeout" };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
