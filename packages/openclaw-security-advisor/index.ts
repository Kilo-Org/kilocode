// @ts-ignore: openclaw peer dep provided by the gateway at runtime
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry"; // eslint-disable-line import/no-unresolved
import { AuthExpiredError, submitAudit } from "./src/client.js";
import { runAudit, getPublicIp } from "./src/audit.js";
import { detectPlatform } from "./src/platform.js";
import { startDeviceAuth, pollDeviceAuth } from "./src/auth/device-auth.js";
import {
  writeStoredToken,
  readTokenFromFile,
  clearStoredToken,
  readPendingCode,
  writePendingCode,
  clearPendingCode,
  type PluginLogger,
  type PluginRuntimeConfig,
} from "./src/auth/token-store.js";
import pkg from "./package.json" with { type: "json" };

const PLUGIN_VERSION: string = pkg.version;
const DEFAULT_API_BASE = "https://api.kilo.ai";

type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
};

type CommandResult = {
  text: string;
};

type ToolRegistration = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: () => Promise<ToolResult>;
};

type CommandRegistration = {
  name: string;
  description: string;
  acceptsArgs: boolean;
  handler: (ctx: unknown) => Promise<CommandResult>;
};

/**
 * Structural type covering the parts of the OpenClaw plugin API this
 * plugin uses. The full API is runtime-provided by the gateway; we only
 * constrain the fields we touch so we keep type safety without pinning
 * to the (internal, evolving) full SDK type. Field optionality matches
 * the SDK's OpenClawPluginApi shape so register(api) type-checks.
 */
type PluginApi = {
  pluginConfig?: Record<string, unknown>;
  logger: PluginLogger;
  runtime: {
    config: PluginRuntimeConfig;
  };
  registerTool: (tool: ToolRegistration) => void;
  registerCommand: (cmd: CommandRegistration) => void;
};

function resolveEnvToken(): string | null {
  return process.env.KILOCODE_API_KEY ?? process.env.KILO_API_KEY ?? null;
}

function resolveApiBase(pluginConfig: Record<string, unknown> | null): string {
  const configUrl = pluginConfig?.apiBaseUrl;
  if (typeof configUrl === "string" && configUrl.length > 0) return configUrl;
  if (process.env.KILO_API_URL) return process.env.KILO_API_URL;
  const gatewayUrl = process.env.KILOCODE_API_BASE_URL;
  if (gatewayUrl) {
    try {
      return new URL(gatewayUrl).origin;
    } catch {
      /* fall through */
    }
  }
  return DEFAULT_API_BASE;
}

function toolResult(content: string): ToolResult {
  return { content: [{ type: "text" as const, text: content }] };
}

/**
 * Top-level wrapper around runSecurityAdvisorFlow. Catches any
 * unexpected throw from the flow (transient network errors during
 * runAudit, the server returning a non-401 failure, writeStoredToken
 * blowing up with EPERM, etc.) and converts it to a user-friendly
 * markdown string so the command / tool handler never surfaces a raw
 * stack to the chat. Recognized error paths (AuthExpiredError, the
 * server returning a rate_limited body, audit script returning a
 * non-zero exit code) are already handled inside the flow and return
 * their own specific messages; this is the last-resort safety net.
 */
async function runFlowSafe(api: PluginApi, apiBase: string): Promise<string> {
  try {
    return await runSecurityAdvisorFlow(api, apiBase);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    api.logger.error?.(`security-advisor: unexpected failure: ${message}`);
    return (
      `Security checkup failed unexpectedly: ${message}\n\n` +
      `Check the openclaw gateway logs for details, or try again.`
    );
  }
}

/**
 * Shared security-advisor flow used by both the registerTool entry point
 * (natural language invocation via the LLM) and the registerCommand entry
 * point (deterministic /security-checkup slash command).
 *
 * Returns plain markdown. Callers wrap it in whatever shape their
 * registration API expects.
 */
async function runSecurityAdvisorFlow(api: PluginApi, apiBase: string): Promise<string> {
  // Path A: KiloClaw. KILOCODE_API_KEY env var injected at VM boot.
  // If this token is expired we can't auto recover (env vars are set
  // externally), so tell the user clearly.
  const envToken = resolveEnvToken();
  if (envToken) {
    try {
      return await doCheckup(apiBase, envToken);
    } catch (err) {
      if (err instanceof AuthExpiredError) {
        return (
          "Your `KILOCODE_API_KEY` environment variable is invalid or expired. " +
          "Update the env var with a fresh KiloCode API key and try again."
        );
      }
      throw err;
    }
  }

  // Path B: returning self-hosted user. Read token directly from secrets
  // file. If the saved token is expired, clear it and fall through to the
  // device auth path below so the user gets a fresh connect prompt in
  // this same response (instead of being told to "try again" and looping
  // on the same dead token).
  const savedToken = await readTokenFromFile();
  if (savedToken) {
    try {
      return await doCheckup(apiBase, savedToken);
    } catch (err) {
      if (!(err instanceof AuthExpiredError)) throw err;
      await clearStoredToken();
      // fall through to Path C1 (device auth initiation)
    }
  }

  // Path C2: pending code exists from a previous call. User completed
  // the browser flow, now poll and finalize.
  const pending = await readPendingCode();
  if (pending) {
    const pollResult = await pollDeviceAuth(apiBase, pending, api.logger);

    if (pollResult.kind === "approved") {
      await clearPendingCode();

      // Run the checkup with the freshly approved token BEFORE persisting
      // it. Writing the token triggers a config write which causes a
      // gateway restart. If we ran the checkup after that, the user would
      // see a "connected, run me again" stub and have to invoke a third
      // time. Doing the checkup first lets us return the actual report on
      // this invocation. The token persist still happens after, so
      // subsequent invocations skip device auth and go straight to Path B.
      const reportMarkdown = await (async (): Promise<string> => {
        try {
          return await doCheckup(apiBase, pollResult.token);
        } catch (err) {
          if (err instanceof AuthExpiredError) {
            // Edge case: server approved the token but immediately
            // rejected the audit request with 401. Shouldn't normally
            // happen.
            return (
              "Connected to KiloCode, but the audit request was rejected. " +
              "Run the security checkup again to retry."
            );
          }
          throw err;
        }
      })();

      try {
        await writeStoredToken(api, pollResult.token);
      } catch (err) {
        // Don't fail the response shown to the user. They already have
        // their report from doCheckup. Worst case: token isn't saved and
        // they redo device auth next time.
        const message = err instanceof Error ? err.message : String(err);
        api.logger.warn?.(`security-advisor: failed to persist auth token: ${message}`);
      }

      return reportMarkdown;
    }

    if (pollResult.kind === "denied") {
      await clearPendingCode();
      return "Authentication was denied. Run the security checkup again to start over.";
    }

    if (pollResult.kind === "expired") {
      // Server reported the device auth code is dead (410 Gone or
      // explicit expired status). Clear and start over.
      await clearPendingCode();
      return "Authentication code expired. Run the security checkup again to get a fresh code.";
    }

    if (pollResult.kind === "timeout") {
      // Our local poll deadline was hit while the server was still
      // returning pending. The code may still be valid server-side.
      // Leave the pending code in place so the next invocation picks up
      // where we left off, and tell the user to retry once they've
      // approved in the browser.
      return (
        "Still waiting for you to approve in the browser.\n\n" +
        "Once you've approved, run the security checkup again and we'll pick up where we left off."
      );
    }
    // pollResult.kind === "pending" (shouldn't reach here: pollDeviceAuth
    // loops internally until a terminal state or timeout). Fall through
    // to treat as timeout for safety.
    return (
      "Still waiting for you to approve in the browser.\n\n" +
      "Once you've approved, run the security checkup again."
    );
  }

  // Path C1: new self-hosted user. Initiate device auth.
  const authStart = await startDeviceAuth(apiBase);
  await writePendingCode(authStart.code);
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

async function doCheckup(apiBase: string, token: string): Promise<string> {
  const auditResult = await runAudit();
  if (!auditResult.ok) {
    return auditResult.error;
  }

  const publicIp = await getPublicIp();

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
}

export default definePluginEntry({
  id: "openclaw-security-advisor",
  name: "OpenClaw Security Advisor",
  description:
    "Run a security checkup of your OpenClaw instance and get an expert analysis report from KiloCode.",
  // The SDK's OpenClawPluginApi type is large and internal. We narrow
  // to our own structural PluginApi (declared above) immediately on
  // entry so everything inside this function is strongly typed.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  register(sdkApi: any) {
    const api = sdkApi as PluginApi;
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
        const apiBase = resolveApiBase(pluginConfig);
        const markdown = await runFlowSafe(api, apiBase);
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
      handler: async (_ctx: unknown) => {
        const apiBase = resolveApiBase(pluginConfig);
        const markdown = await runFlowSafe(api, apiBase);
        return { text: markdown };
      },
    });

    api.logger.info?.("Registered tool: kilocode_security_advisor");
    api.logger.info?.("Registered command: /security-checkup");
  },
});
