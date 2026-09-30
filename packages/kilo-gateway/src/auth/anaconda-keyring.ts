/**
 * Anaconda keyring read/write.
 *
 * Replicates the exact format used by anaconda-cli (Rust) so both tools
 * can share `~/.anaconda/keyring` without corruption.
 *
 * Format:
 *   { "Anaconda Cloud": { "<domain>": "<base64(Credential JSON)>" } }
 *
 * Credential JSON (version 2):
 *   { domain, api_key, repo_tokens: [], version: 2, user_id?, username? }
 *
 * - None/undefined fields are omitted (not serialized as null).
 * - Base64 uses standard alphabet (not URL-safe).
 * - File permissions: 0o600. Parent directory: 0o700.
 */

import fs from "node:fs"
import path from "node:path"
import os from "node:os"

const KEYRING_KEY = "Anaconda Cloud"
const CREDENTIAL_VERSION = 2
const DEFAULT_DOMAIN = "anaconda.com"

/** Matches anaconda-cli's Credential / TokenInfo struct. */
interface Credential {
  domain: string
  api_key: string
  repo_tokens: RepoToken[]
  version: number
  user_id?: string
  username?: string
}

interface RepoToken {
  token: string
  org_name?: string
}

/** Top-level keyring: key → domain → base64-encoded credential. */
type Keyring = Record<string, Record<string, string>>

function keyringPath(): string {
  return process.env.ANA_KEYRING_PATH ?? path.join(os.homedir(), ".anaconda", "keyring")
}

function loadKeyring(filepath: string): Keyring {
  if (!fs.existsSync(filepath)) return {}
  const raw = fs.readFileSync(filepath, "utf-8")
  if (raw.trim().length === 0) return {}
  return JSON.parse(raw) as Keyring
}

/** Create directory with 0o700 permissions (owner rwx only). */
function ensureDir(dir: string) {
  if (fs.existsSync(dir)) return
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  // mkdirSync with mode only affects the leaf on some platforms;
  // explicitly set permissions to match anaconda-cli.
  fs.chmodSync(dir, 0o700)
}

/** Write file with 0o600 permissions (owner rw only), truncating. */
function writeSecure(filepath: string, data: string) {
  const fd = fs.openSync(filepath, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_TRUNC, 0o600)
  fs.writeSync(fd, data)
  fs.closeSync(fd)
}

/**
 * Build a compact JSON string for a Credential, omitting undefined fields
 * (matching Rust's `skip_serializing_if = "Option::is_none"`).
 */
function serializeCredential(cred: Credential): string {
  const obj: Record<string, unknown> = {
    domain: cred.domain,
    api_key: cred.api_key,
    repo_tokens: cred.repo_tokens,
    version: cred.version,
  }
  if (cred.user_id != null) obj.user_id = cred.user_id
  if (cred.username != null) obj.username = cred.username
  return JSON.stringify(obj)
}

export interface SaveCredentialOpts {
  apiKey: string
  domain?: string
  userId?: string
  username?: string
}

/**
 * Save an API key to the anaconda keyring file.
 *
 * Reads the existing keyring first and merges, so credentials for
 * other domains are preserved.
 */
export function saveCredential(opts: SaveCredentialOpts): void {
  const domain = opts.domain ?? DEFAULT_DOMAIN
  const filepath = keyringPath()

  const parent = path.dirname(filepath)
  ensureDir(parent)

  const keyring = loadKeyring(filepath)

  const cred: Credential = {
    domain,
    api_key: opts.apiKey,
    repo_tokens: [],
    version: CREDENTIAL_VERSION,
    ...(opts.userId != null && { user_id: opts.userId }),
    ...(opts.username != null && { username: opts.username }),
  }

  const encoded = Buffer.from(serializeCredential(cred)).toString("base64")

  if (!keyring[KEYRING_KEY]) {
    keyring[KEYRING_KEY] = {}
  }
  keyring[KEYRING_KEY][domain] = encoded

  writeSecure(filepath, JSON.stringify(keyring))
}

/**
 * Read an API key from the anaconda keyring file.
 *
 * Returns undefined if the keyring or domain entry doesn't exist.
 */
export function getApiKey(domain?: string): string | undefined {
  const target = domain ?? DEFAULT_DOMAIN
  const filepath = keyringPath()
  const keyring = loadKeyring(filepath)
  const domains = keyring[KEYRING_KEY]
  if (!domains) return undefined
  const encoded = domains[target]
  if (!encoded) return undefined
  const decoded = Buffer.from(encoded, "base64").toString("utf-8")
  const cred = JSON.parse(decoded) as Credential
  return cred.api_key
}
