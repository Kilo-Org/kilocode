import { runPluginCommandWithTimeout } from "openclaw/plugin-sdk/run-command";
import type { SubmitAuditPayload } from "./client.js";

/**
 * Run `openclaw security audit --deep --json` using the SDK's command runner.
 */
export async function runAudit(): Promise<
  { ok: true; audit: SubmitAuditPayload["audit"] } | { ok: false; error: string }
> {
  const result = await runPluginCommandWithTimeout({
    argv: ["openclaw", "security", "audit", "--json"],
    timeoutMs: 60_000,
  });

  if (result.code !== 0) {
    return {
      ok: false,
      error: `Security audit failed (exit code ${result.code}): ${result.stderr}`,
    };
  }

  try {
    const audit = JSON.parse(result.stdout);
    return { ok: true, audit };
  } catch {
    return {
      ok: false,
      error: "Security audit returned invalid JSON. Try running 'openclaw security audit --deep --json' manually.",
    };
  }
}

/**
 * Get the public IP of this instance. Best effort — returns undefined on failure.
 */
export async function getPublicIp(): Promise<string | undefined> {
  const result = await runPluginCommandWithTimeout({
    argv: ["curl", "-s", "--max-time", "5", "https://ifconfig.me"],
    timeoutMs: 10_000,
  });

  if (result.code === 0) {
    const ip = result.stdout.trim();
    if (/^[\d.:a-fA-F]+$/.test(ip)) return ip;
  }

  return undefined;
}

/**
 * Detect whether this is a KiloClaw managed instance or self-hosted OpenClaw.
 */
export function detectPlatform(): "kiloclaw" | "openclaw" {
  return process.env.KILOCLAW_INTERNAL_API_SECRET ? "kiloclaw" : "openclaw";
}
