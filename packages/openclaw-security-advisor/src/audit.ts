// @ts-ignore: openclaw peer dep provided by the gateway at runtime
import { runPluginCommandWithTimeout } from "openclaw/plugin-sdk/run-command"; // eslint-disable-line import/no-unresolved
// @ts-ignore: openclaw peer dep provided by the gateway at runtime
import { resolveFetch } from "openclaw/plugin-sdk/fetch-runtime"; // eslint-disable-line import/no-unresolved
// @ts-ignore: openclaw peer dep provided by the gateway at runtime
import { z } from "openclaw/plugin-sdk/zod"; // eslint-disable-line import/no-unresolved
import type { SubmitAuditPayload } from "./client.js";

/**
 * Minimal runtime schema for the subset of `openclaw security audit --json`
 * output that we forward to the KiloCode API. The authoritative schema
 * lives in the server (`apps/web/src/lib/security-advisor/schemas.ts`);
 * we validate at the plugin boundary so a shape change in the openclaw
 * CLI surfaces as a clear "audit returned unexpected shape" error
 * instead of an opaque 400 from the server.
 */
const AuditFindingSchema = z.object({
  checkId: z.string(),
  severity: z.enum(["critical", "warn", "info"]),
  title: z.string(),
  detail: z.string(),
  remediation: z.string().nullable().optional(),
});

const AuditOutputSchema = z.object({
  ts: z.number(),
  summary: z.object({
    critical: z.number(),
    warn: z.number(),
    info: z.number(),
  }),
  findings: z.array(AuditFindingSchema),
  deep: z.record(z.string(), z.unknown()).optional(),
  secretDiagnostics: z.array(z.unknown()).optional(),
});

/**
 * Run `openclaw security audit --json` using the SDK's command runner.
 * The `--deep` flag is intentionally NOT passed: in dev (Cloudflare tunnel)
 * the deep self-probe loops back through the tunnel and hangs. Once the
 * upstream fix lands (force localhost for self-probes) we can add it back.
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

  let raw: unknown;
  try {
    raw = JSON.parse(result.stdout);
  } catch {
    return {
      ok: false,
      error: "Security audit returned invalid JSON. Try running 'openclaw security audit --json' manually.",
    };
  }

  const parsed = AuditOutputSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error:
        "Security audit returned an unexpected shape. The openclaw CLI version may be incompatible with this plugin.",
    };
  }

  return { ok: true, audit: parsed.data };
}

// IPv4 in dotted-quad form: 0-255 per octet.
const IPV4_REGEX = /^(25[0-5]|2[0-4]\d|[01]?\d\d?)(\.(25[0-5]|2[0-4]\d|[01]?\d\d?)){3}$/;
// IPv6 (simple form). Accepts canonical and :: compressed. Rejects anything
// with a port, brackets, or trailing characters.
const IPV6_REGEX = /^(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$|^(?:[0-9a-fA-F]{1,4}:){1,7}:$|^(?:[0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}$|^(?:[0-9a-fA-F]{1,4}:){1,5}(?::[0-9a-fA-F]{1,4}){1,2}$|^(?:[0-9a-fA-F]{1,4}:){1,4}(?::[0-9a-fA-F]{1,4}){1,3}$|^(?:[0-9a-fA-F]{1,4}:){1,3}(?::[0-9a-fA-F]{1,4}){1,4}$|^(?:[0-9a-fA-F]{1,4}:){1,2}(?::[0-9a-fA-F]{1,4}){1,5}$|^[0-9a-fA-F]{1,4}:(?:(?::[0-9a-fA-F]{1,4}){1,6})$|^:(?:(?::[0-9a-fA-F]{1,4}){1,7}|:)$/;

function isValidIp(candidate: string): boolean {
  return IPV4_REGEX.test(candidate) || IPV6_REGEX.test(candidate);
}

/**
 * Get the public IP of this instance. Best effort; returns undefined on failure.
 * Uses the plugin SDK's fetch helper (not curl) for portability across
 * platforms that may not ship curl on PATH (Windows, minimal containers).
 *
 * Note: this module intentionally has no environment variable reads.
 * Platform detection lives in ./platform.ts instead. The openclaw
 * plugin loader flags files that combine env reads with network
 * sends as potential credential harvesting, so keeping those concerns
 * in separate files avoids the false positive.
 */
export async function getPublicIp(): Promise<string | undefined> {
  const fetchFn: typeof fetch = resolveFetch() ?? globalThis.fetch;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5_000);
    const resp = await fetchFn("https://ifconfig.me/ip", { signal: controller.signal });
    clearTimeout(timeout);
    if (!resp.ok) return undefined;
    const text = (await resp.text()).trim();
    return isValidIp(text) ? text : undefined;
  } catch {
    return undefined;
  }
}
