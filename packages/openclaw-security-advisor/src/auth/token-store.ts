import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const PLUGIN_ID = "openclaw-security-advisor";
const PROVIDER_ID = "kilocode_security_advisor";

export function secretFilePath(): string {
  return join(homedir(), ".openclaw", "secrets", `${PLUGIN_ID}-auth-token`);
}

type PluginApi = {
  runtime: {
    config: {
      loadConfig: () => unknown;
      writeConfigFile: (cfg: unknown) => Promise<void>;
    };
  };
};

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
export async function writeStoredToken(api: PluginApi, token: string): Promise<void> {
  const filePath = secretFilePath();

  // 1. Write token to secrets file (mode 600, owner read/write only)
  await mkdir(join(homedir(), ".openclaw", "secrets"), { recursive: true });
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
  } catch {
    return null;
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
  } catch {
    // File already missing. That's the target state, no-op.
  }
}

// --- In-memory pending code (no config write, no restart) ---

let _pendingCode: string | null = null;

export function writePendingCode(code: string): void {
  _pendingCode = code;
}

export function readPendingCode(): string | null {
  return _pendingCode;
}

export function clearPendingCode(): void {
  _pendingCode = null;
}
