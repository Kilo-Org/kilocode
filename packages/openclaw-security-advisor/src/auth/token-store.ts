import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const PLUGIN_ID = "openclaw-security-advisor";
const PROVIDER_ID = "kilocode_security_advisor";

/**
 * Minimal structural type for the parts of the OpenClaw plugin API this
 * module touches. We don't want to import the full SDK type surface
 * (resolved at runtime by the plugin host), but we also don't want to
 * leak `any` into callers. This interface documents the contract we
 * rely on.
 *
 * Method shorthand (not arrow property) is used on purpose so the
 * parameter types are bivariant, letting the SDK's concrete
 * OpenClawConfig satisfy our `unknown` parameter without requiring us
 * to import the internal SDK type.
 */
export type PluginRuntimeConfig = {
  loadConfig(): unknown;
  writeConfigFile(cfg: unknown): Promise<void>;
};

export type PluginLogger = {
  info?: (msg: string) => void;
  warn?: (msg: string) => void;
  debug?: (msg: string) => void;
  error?: (msg: string) => void;
};

export type TokenStoreApi = {
  runtime: {
    config: PluginRuntimeConfig;
  };
};

export function secretFilePath(): string {
  return join(homedir(), ".openclaw", "secrets", `${PLUGIN_ID}-auth-token`);
}

function pendingCodeFilePath(): string {
  return join(homedir(), ".openclaw", "secrets", `${PLUGIN_ID}-pending-code`);
}

async function ensureSecretsDir(): Promise<void> {
  await mkdir(join(homedir(), ".openclaw", "secrets"), { recursive: true });
}

/**
 * Persist the auth token acquired from device auth:
 * 1. Write the raw token value to a secrets file
 * 2. Register a file-based SecretRef provider in config
 * 3. Point the plugin authToken config at that provider
 *
 * This triggers one gateway restart. On restart, OpenClaw resolves the
 * SecretRef → api.pluginConfig.authToken = the token string, available
 * in the plugin closure forever after.
 */
export async function writeStoredToken(
  api: TokenStoreApi,
  token: string,
): Promise<void> {
  const filePath = secretFilePath();

  // 1. Write token to secrets file (mode 600, owner read/write only)
  await ensureSecretsDir();
  await writeFile(filePath, token, { mode: 0o600 });

  // 2. Patch config: add file provider + SecretRef pointing at it
  const current = api.runtime.config.loadConfig();
  const next = patchConfig(current, filePath);
  await api.runtime.config.writeConfigFile(next);
}

function patchConfig(cfg: unknown, filePath: string): unknown {
  const root = (cfg && typeof cfg === "object" ? cfg : {}) as Record<string, unknown>;

  // Patch secrets.providers.<PROVIDER_ID>
  const secrets = (root.secrets && typeof root.secrets === "object" ? root.secrets : {}) as Record<string, unknown>;
  const providers = (secrets.providers && typeof secrets.providers === "object" ? secrets.providers : {}) as Record<string, unknown>;
  const nextSecrets = {
    ...secrets,
    providers: {
      ...providers,
      [PROVIDER_ID]: {
        source: "file",
        path: filePath,
        mode: "singleValue",
      },
    },
  };

  // Patch plugins.entries.<PLUGIN_ID>.config.authToken with SecretRef
  const plugins = (root.plugins && typeof root.plugins === "object" ? root.plugins : {}) as Record<string, unknown>;
  const entries = (plugins.entries && typeof plugins.entries === "object" ? plugins.entries : {}) as Record<string, unknown>;
  const existing = (entries[PLUGIN_ID] && typeof entries[PLUGIN_ID] === "object" ? entries[PLUGIN_ID] : {}) as Record<string, unknown>;
  const existingConfig = (existing.config && typeof existing.config === "object" ? existing.config : {}) as Record<string, unknown>;

  const nextPlugins = {
    ...plugins,
    entries: {
      ...entries,
      [PLUGIN_ID]: {
        ...existing,
        config: {
          ...existingConfig,
          authToken: {
            source: "file",
            provider: PROVIDER_ID,
            id: "value",
          },
        },
      },
    },
  };

  return { ...root, secrets: nextSecrets, plugins: nextPlugins };
}

/**
 * Read the token directly from the secrets file.
 * Reliable at any point. No dependency on OpenClaw's SecretRef resolution timing.
 */
export async function readTokenFromFile(): Promise<string | null> {
  try {
    const content = await readFile(secretFilePath(), "utf-8");
    const trimmed = content.trim();
    return trimmed.length > 0 ? trimmed : null;
  } catch (err) {
    // Missing file is the expected "no saved token" state. Anything
    // else (permissions, stale NFS handle, IO error) should surface
    // instead of silently falling through to device auth with no
    // indication of why the token couldn't be read.
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return null;
    throw err;
  }
}

/**
 * Delete the stored token file. Called when the server rejects a saved
 * token (expired/revoked) so the next flow invocation falls through to
 * device auth instead of endlessly retrying a dead token.
 *
 * The openclaw.json config still points at the (now missing) SecretRef,
 * but since the plugin reads tokens via readTokenFromFile() directly
 * (not via api.pluginConfig.authToken), a missing file is equivalent to
 * "no token" and Path C1 (device auth) kicks in naturally.
 */
export async function clearStoredToken(): Promise<void> {
  try {
    await unlink(secretFilePath());
  } catch (err) {
    // File already missing is the target state. Any other error
    // (permissions, stale NFS handle, etc.) needs to surface.
    if ((err as NodeJS.ErrnoException)?.code !== "ENOENT") {
      throw err;
    }
  }
}

// --- Pending device-auth code ---
//
// Persisted to a small file next to the token so a gateway restart
// during the two-step device auth flow doesn't lose the code the user
// is actively looking at. The file contains JSON:
//   { code: string, expiresAtMs: number }
//
// Expiry is tracked client-side to match the server TTL (10 min). An
// expired file is treated as "no pending code" and cleaned up.

const PENDING_CODE_TTL_MS = 10 * 60 * 1_000;

type PendingCodeFile = {
  code: string;
  expiresAtMs: number;
};

export async function writePendingCode(code: string): Promise<void> {
  await ensureSecretsDir();
  const payload: PendingCodeFile = {
    code,
    expiresAtMs: Date.now() + PENDING_CODE_TTL_MS,
  };
  await writeFile(pendingCodeFilePath(), JSON.stringify(payload), {
    mode: 0o600,
  });
}

export async function readPendingCode(): Promise<string | null> {
  let content: string;
  try {
    content = await readFile(pendingCodeFilePath(), "utf-8");
  } catch (err) {
    // Missing file is the expected "no pending code" state. Anything
    // else (permissions, stale NFS handle, IO error) should surface
    // instead of silently looping the user back through device auth.
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return null;
    throw err;
  }

  let parsed: PendingCodeFile;
  try {
    parsed = JSON.parse(content) as PendingCodeFile;
  } catch {
    // Corrupt file. Treat as missing and clean up.
    await clearPendingCode();
    return null;
  }

  if (
    typeof parsed?.code !== "string" ||
    typeof parsed?.expiresAtMs !== "number"
  ) {
    await clearPendingCode();
    return null;
  }

  if (Date.now() > parsed.expiresAtMs) {
    // Expired locally. The server code is also dead, so clean up.
    await clearPendingCode();
    return null;
  }

  return parsed.code;
}

export async function clearPendingCode(): Promise<void> {
  try {
    await unlink(pendingCodeFilePath());
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code !== "ENOENT") {
      throw err;
    }
  }
}
