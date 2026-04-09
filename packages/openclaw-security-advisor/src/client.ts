import { resolveFetch } from "openclaw/plugin-sdk/fetch-runtime";

const API_VERSION = "2026-04-01";

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
  const fetchFn = resolveFetch();

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
      const body = await resp.json();
      errorMessage = body?.error?.message;
    } catch {
      // not JSON
    }

    if (resp.status === 401) {
      throw new Error(
        "Authentication failed. Your KiloClaw API key may be invalid or expired."
      );
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
