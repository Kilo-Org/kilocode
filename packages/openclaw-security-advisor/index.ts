import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { submitAudit } from "./src/client.js";
import { runAudit, getPublicIp, detectPlatform } from "./src/audit.js";

const PLUGIN_VERSION = "0.1.0";
const DEFAULT_API_BASE = "https://api.kilo.ai";

/**
 * Resolve the KiloClaw API key.
 */
function resolveToken(): string | null {
  return process.env.KILOCODE_API_KEY ?? process.env.KILO_API_KEY ?? null;
}

/**
 * Resolve the API base URL.
 */
function resolveApiBase(): string {
  if (process.env.KILO_API_URL) return process.env.KILO_API_URL;

  const gatewayUrl = process.env.KILOCODE_API_BASE_URL;
  if (gatewayUrl) {
    try {
      return new URL(gatewayUrl).origin;
    } catch {
      // Invalid URL, fall through
    }
  }

  return DEFAULT_API_BASE;
}

export default definePluginEntry({
  id: "openclaw-security-advisor",
  name: "OpenClaw Security Advisor",
  register(api) {
    api.registerTool({
      name: "security_checkup",
      description:
        "Run a full security audit of this OpenClaw instance and get an expert analysis " +
        "report from KiloClaw. Checks file permissions, authentication, network exposure, " +
        "TLS, secrets storage, and more. " +
        "Returns a pre-formatted markdown security report. " +
        "Display the report to the user exactly as returned, without rewriting or summarizing.",
      parameters: {},
      async execute() {
        const token = resolveToken();
        if (!token) {
          return {
            content: [
              {
                type: "text" as const,
                text:
                  "You need to set up KiloClaw before running a security checkup.\n\n" +
                  "Run `openclaw provider add kilocode` to connect your KiloClaw account, " +
                  "or sign up for a free trial at https://kilo.ai/kiloclaw",
              },
            ],
          };
        }

        const auditResult = await runAudit();
        if (!auditResult.ok) {
          return {
            content: [{ type: "text" as const, text: auditResult.error }],
          };
        }

        const publicIp = await getPublicIp();

        try {
          const apiBase = resolveApiBase();
          const response = await submitAudit(apiBase, token, {
            audit: auditResult.audit,
            publicIp,
            source: {
              platform: detectPlatform(),
              method: "plugin",
              pluginVersion: PLUGIN_VERSION,
            },
          });

          return {
            content: [{ type: "text" as const, text: response.report.markdown }],
          };
        } catch (err) {
          const message =
            err instanceof Error ? err.message : "Unknown error";
          return {
            content: [
              {
                type: "text" as const,
                text: `Security analysis failed: ${message}`,
              },
            ],
          };
        }
      },
    });

    api.logger.info("Registered tool: security_checkup");
  },
});
