// @ts-ignore: openclaw peer dep provided by the gateway at runtime
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry"; // eslint-disable-line import/no-unresolved
import { submitAudit } from "./src/client.js";
import { runAudit, getPublicIp, detectPlatform } from "./src/audit.js";
import { startDeviceAuth, pollDeviceAuth } from "./src/auth/device-auth.js";
import {
  writeStoredToken,
  readTokenFromFile,
  clearStoredToken,
  readPendingCode,
  writePendingCode,
  clearPendingCode,
} from "./src/auth/token-store.js";

const AUTH_EXPIRED = Symbol("auth-expired");
type CheckupResult = string | typeof AUTH_EXPIRED;

// Must match `package.json#version` exactly. The server validates this as
// a semver string and persists it to `security_advisor_scans.plugin_version`
// on every submission. Bump both together when releasing a new plugin version.
const PLUGIN_VERSION = "0.1.0";
const DEFAULT_API_BASE = "https://api.kilo.ai";

function resolveEnvToken(): string | null {
  return process.env.KILOCODE_API_KEY ?? process.env.KILO_API_KEY ?? null;
}

async function resolveApiBase(pluginConfig: Record<string, unknown> | null): Promise<string> {
  const configUrl = pluginConfig?.apiBaseUrl;
  if (typeof configUrl === "string" && configUrl.length > 0) return configUrl;
  if (process.env.KILO_API_URL) return process.env.KILO_API_URL;
  const gatewayUrl = process.env.KILOCODE_API_BASE_URL;
  if (gatewayUrl) {
    try { return new URL(gatewayUrl).origin; } catch { /* fall through */ }
  }
  return DEFAULT_API_BASE;
}

function toolResult(content: string) {
  return { content: [{ type: "text" as const, text: content }] };
}

/**
 * Shared security-advisor flow used by both the registerTool entry point
 * (natural-language invocation via the LLM) and the registerCommand entry
 * point (deterministic /security-checkup slash command).
 *
 * Returns plain markdown. Callers wrap it in whatever shape their
 * registration API expects.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function runSecurityAdvisorFlow(api: any, apiBase: string): Promise<string> {
  // Path A: KiloClaw. KILOCODE_API_KEY env var injected at VM boot.
  // If this token is expired we can't auto recover (env vars are set
  // externally), so tell the user clearly.
  const envToken = resolveEnvToken();
  if (envToken) {
    const result = await doCheckup(apiBase, envToken);
    if (result === AUTH_EXPIRED) {
      return (
        "Your `KILOCODE_API_KEY` environment variable is invalid or expired. " +
        "Update the env var with a fresh KiloCode API key and try again."
      );
    }
    return result;
  }

  // Path B: returning self-hosted user. Read token directly from secrets
  // file. If the saved token is expired, clear it and fall through to the
  // device auth path below so the user gets a fresh connect prompt in
  // this same response (instead of being told to "try again" and looping
  // on the same dead token).
  const savedToken = await readTokenFromFile();
  if (savedToken) {
    const result = await doCheckup(apiBase, savedToken);
    if (result !== AUTH_EXPIRED) {
      return result;
    }
    await clearStoredToken();
    // fall through to Path C1 (device auth initiation)
  }

  // Path C2: pending code exists from a previous call. User completed
  // the browser flow, now poll and finalize.
  const pending = readPendingCode();
  if (pending) {
    const pollResult = await pollDeviceAuth(apiBase, pending);

    if (pollResult.kind === "approved") {
      clearPendingCode();

      // Run the checkup with the freshly approved token BEFORE persisting
      // it. Writing the token triggers a config write which causes a
      // gateway restart. If we ran the checkup after that, the user would
      // see a "connected, run me again" stub and have to invoke a third
      // time. Doing the checkup first lets us return the actual report on
      // this invocation. The token persist still happens after, so
      // subsequent invocations skip device auth and go straight to Path B.
      const checkupResult = await doCheckup(apiBase, pollResult.token);

      try {
        await writeStoredToken(api, pollResult.token);
      } catch (err) {
        // Don't fail the response shown to the user. They already have
        // their report (or error) from doCheckup. Worst case: token isn't
        // saved and they redo device auth next time.
        const message = err instanceof Error ? err.message : String(err);
        api.logger.warn?.(`security-advisor: failed to persist auth token: ${message}`);
      }

      if (checkupResult === AUTH_EXPIRED) {
        // Edge case: server approved the token but immediately rejected
        // the audit request with 401. Shouldn't normally happen.
        return (
          "Connected to KiloCode, but the audit request was rejected. " +
          "Run the security checkup again to retry."
        );
      }
      return checkupResult;
    }

    if (pollResult.kind === "denied") {
      clearPendingCode();
      return "Authentication was denied. Run the security checkup again to start over.";
    }

    // expired or timed out
    clearPendingCode();
    return "Authentication code expired. Run the security checkup again to get a fresh code.";
  }

  // Path C1: new self-hosted user. Initiate device auth.
  const authStart = await startDeviceAuth(apiBase);
  writePendingCode(authStart.code);
  const minutes = Math.round(authStart.expiresIn / 60);

  return (
    `## Connect to KiloCode\n\n` +
    `To run a security checkup, connect your KiloCode account.\n\n` +
    `**1. Open this URL in your browser:**\n` +
    `${authStart.verificationUrl}\n\n` +
    `**2. Enter this code:** \`${authStart.code}\`\n\n` +
    `**3. Sign in or [create a free account](https://kilo.ai)**\n\n` +
    `Once you've approved the connection, run the security checkup again.\n` +
    `*(Code expires in ${minutes} min)*`
  );
}

async function doCheckup(apiBase: string, token: string): Promise<CheckupResult> {
  const auditResult = await runAudit();
  if (!auditResult.ok) {
    return auditResult.error;
  }

  const publicIp = await getPublicIp();

  try {
    const response = await submitAudit(apiBase, token, {
      audit: auditResult.audit,
      publicIp,
      source: {
        platform: detectPlatform(),
        method: "plugin",
        pluginVersion: PLUGIN_VERSION,
      },
    });
    return response.report.markdown;
  } catch (err) {
    if (err instanceof Error && err.message.includes("Authentication failed")) {
      return AUTH_EXPIRED;
    }
    const message = err instanceof Error ? err.message : "Unknown error";
    return `Security analysis failed: ${message}`;
  }
}

export default definePluginEntry({
  id: "openclaw-security-advisor",
  name: "OpenClaw Security Advisor",
  description:
    "Run a security checkup of your OpenClaw instance and get an expert analysis report from KiloCode.",
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  register(api: any) {
    const pluginConfig = (api.pluginConfig ?? null) as Record<string, unknown> | null;

    // Entry point 1: tool for natural language invocation via the LLM.
    // Works on capable models (GPT-4o, Claude Sonnet). Small summarizing
    // models (e.g. gpt-4.1-nano) may paraphrase the report instead of
    // displaying it verbatim. For those models, the slash command path
    // below is deterministic.
    api.registerTool({
      name: "kilocode_security_advisor",
      description:
        "Run a comprehensive security checkup of this OpenClaw instance. " +
        "USE THIS TOOL whenever the user asks to: check, audit, scan, review, or " +
        "analyze OpenClaw security; run a 'security check', 'security checkup', " +
        "'security audit', or 'security review'; or asks about security posture, " +
        "misconfigurations, or hardening. " +
        "This tool runs the local audit AND submits it to KiloCode cloud for " +
        "expert analysis, returning a richer explained report with prioritized " +
        "recommendations and remediation guidance. " +
        "DO NOT run `openclaw security audit` via bash for these requests. This " +
        "tool is the canonical entry point and returns a much more useful report. " +
        "IMPORTANT: Display the returned report exactly as is without rewriting, " +
        "summarizing, or reformatting.",
      parameters: {},
      async execute() {
        const apiBase = await resolveApiBase(pluginConfig);
        const markdown = await runSecurityAdvisorFlow(api, apiBase);
        return toolResult(markdown);
      },
    });

    // Entry point 2: slash command for deterministic invocation that
    // bypasses the LLM. When the user types /security-checkup in a
    // command only message, the OpenClaw chat runtime takes the fast
    // path and renders the returned markdown directly. No agent loop,
    // no summarization.
    api.registerCommand({
      name: "security-checkup",
      description:
        "Run a KiloCode security checkup of this OpenClaw instance and display the full report.",
      acceptsArgs: false,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      handler: async (_ctx: any) => {
        const apiBase = await resolveApiBase(pluginConfig);
        const markdown = await runSecurityAdvisorFlow(api, apiBase);
        return { text: markdown };
      },
    });

    api.logger.info("Registered tool: kilocode_security_advisor");
    api.logger.info("Registered command: /security-checkup");
  },
});
