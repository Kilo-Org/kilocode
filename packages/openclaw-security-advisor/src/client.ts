import { resolveFetch } from "openclaw/plugin-sdk/fetch-runtime"; // eslint-disable-line import/no-unresolved

const API_VERSION = "2026-04-01";

/**
 * Thrown when the KiloCode API rejects our request with 401. Callers
 * use `instanceof` (not substring matching on error messages) to decide
 * whether to clear a stale token and re-run device auth.
 */
export class AuthExpiredError extends Error {
  constructor(message = "KiloCode authentication is invalid or expired.") {
    super(message);
    this.name = "AuthExpiredError";
  }
}

export interface SubmitAuditPayload {
  audit: {
    ts: number;
    summary: { critical: number; warn: number; info: number };
    findings: Array<{
      checkId: string;
      severity: "critical" | "warn" | "info";
      title: string;
      detail: string;
      remediation?: string | null;
    }>;
    deep?: Record<string, unknown>;
    secretDiagnostics?: unknown[];
  };
  publicIp?: string;
  source: {
    platform: "openclaw" | "kiloclaw";
    method: "plugin" | "api" | "webhook" | "cloud-agent";
    pluginVersion?: string;
    openclawVersion?: string;
  };
}

export interface AnalyzeResponse {
  apiVersion: string;
  status: "success";
  report: {
    markdown: string;
    summary: { critical: number; warn: number; info: number; passed: number };
    findings: Array<{
      checkId: string;
      severity: string;
      title: string;
      explanation: string;
      risk: string;
      fix: string | null;
      kiloClawComparison: string | null;
    }>;
    recommendations: Array<{ priority: string; action: string }>;
  };
}

export async function submitAudit(
  apiBase: string,
  token: string,
  payload: SubmitAuditPayload
): Promise<AnalyzeResponse> {
  const fetchFn: typeof fetch = resolveFetch() ?? globalThis.fetch;

  const resp = await fetchFn(`${apiBase}/api/security-advisor/analyze`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      apiVersion: API_VERSION,
      ...payload,
    }),
  });

  if (!resp.ok) {
    let errorMessage: string | undefined;
    try {
      const body = (await resp.json()) as { error?: { message?: string } };
      errorMessage = body?.error?.message;
    } catch {
      // not JSON
    }

    if (resp.status === 401) {
      throw new AuthExpiredError();
    }
    if (resp.status === 429) {
      throw new Error("Rate limit exceeded. Try again later.");
    }
    throw new Error(
      errorMessage || `Analysis failed: ${resp.status} ${resp.statusText}`
    );
  }

  return (await resp.json()) as AnalyzeResponse;
}
