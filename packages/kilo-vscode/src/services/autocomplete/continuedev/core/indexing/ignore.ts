import ignore from "ignore"

import path from "path"
import { fileURLToPath } from "url"

// Security-focused ignore patterns - these should always be excluded for security reasons
export const DEFAULT_SECURITY_IGNORE_FILETYPES = [
  // Environment and configuration files with secrets
  "*.env",
  "*.env.*",
  ".env*",
  "config.json",
  "config.yaml",
  "config.yml",
  "settings.json",
  "appsettings.json",
  "appsettings.*.json",

  // Certificate and key files
  "*.key",
  "*.pem",
  "*.p12",
  "*.pfx",
  "*.crt",
  "*.cer",
  "*.jks",
  "*.keystore",
  "*.truststore",

  // Database files that may contain sensitive data
  "*.db",
  "*.sqlite",
  "*.sqlite3",
  "*.mdb",
  "*.accdb",

  // Credential and secret files
  "*.secret",
  "*.secrets",
  "credentials",
  "credentials.*",
  "auth.json",
  "token",
  "token.*",
  "*.token",

  // Backup files that might contain sensitive data
  "*.bak",
  "*.backup",
  "*.old",
  "*.orig",

  // Docker secrets
  "docker-compose.override.yml",
  "docker-compose.override.yaml",

  // SSH and GPG
  "id_rsa",
  "id_dsa",
  "id_ecdsa",
  "id_ed25519",
  "*.ppk",
  "*.gpg",
]

export const DEFAULT_SECURITY_IGNORE_DIRS = [
  // Environment and configuration directories
  ".env/",
  "env/",

  // Cloud provider credential directories
  ".aws/",
  ".gcp/",
  ".azure/",
  ".kube/",
  ".docker/",

  // Secret directories
  "secrets/",
  ".secrets/",
  "private/",
  ".private/",
  "certs/",
  "certificates/",
  "keys/",
  ".ssh/",
  ".gnupg/",
  ".gpg/",

  // Temporary directories that might contain sensitive data
  "tmp/secrets/",
  "temp/secrets/",
  ".tmp/",
]

// Create ignore instances
const defaultSecurityIgnoreFile = ignore().add(DEFAULT_SECURITY_IGNORE_FILETYPES)
const defaultSecurityIgnoreDir = ignore().add(DEFAULT_SECURITY_IGNORE_DIRS)

// Combined ignore instances
export const defaultFileAndFolderSecurityIgnores = ignore().add(defaultSecurityIgnoreFile).add(defaultSecurityIgnoreDir)

export function isSecurityConcern(filePathOrUri: string) {
  if (!filePathOrUri) {
    return false
  }
  let filepath = filePathOrUri
  try {
    filepath = fileURLToPath(filePathOrUri)
  } catch {
    // Intentionally ignore - not a valid file URL, continue with original path
  }
  if (path.isAbsolute(filepath)) {
    const segments = filepath.split(/\/|\\/).filter(Boolean)
    // Every trailing slice keeps its full directory context, so a sensitive directory nested deeper than the
    // immediate parent still matches the ignored directory patterns.
    const slices = segments.map((_, index) => segments.slice(index).join("/"))
    return slices.some((slice) => defaultFileAndFolderSecurityIgnores.ignores(slice))
  }
  if (!filepath) {
    return false
  }
  return defaultFileAndFolderSecurityIgnores.ignores(filepath)
}
