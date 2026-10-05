import { fileURLToPath } from "node:url"

const env = "KILO_VALKEY_GLIDE_PATH"

export function resolveGlideSpecifier() {
  const url = process.env[env]
  if (!url) return "@valkey/valkey-glide"
  return url.startsWith("file:") ? fileURLToPath(url) : url
}

export function loadGlide(): typeof import("@valkey/valkey-glide") {
  return require(resolveGlideSpecifier())
}
