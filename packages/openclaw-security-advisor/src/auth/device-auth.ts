// @ts-ignore: openclaw peer dep provided by the gateway at runtime
import { resolveFetch } from "openclaw/plugin-sdk/fetch-runtime"; // eslint-disable-line import/no-unresolved

const POLL_TIMEOUT_MS = 10 * 60 * 1_000; // 10 minutes
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

export type DeviceAuthPollResult =
  | { kind: "approved"; token: string }
  | { kind: "pending" }
  | { kind: "denied" }
  | { kind: "expired" };

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
 * Poll a device auth code until it resolves (approved/denied/expired) or times out.
 * Returns immediately once a terminal state is reached.
 */
export async function pollDeviceAuth(
  apiBase: string,
  code: string,
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
    } catch {
      // transient network error, keep polling
    }
  }

  return { kind: "expired" };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
