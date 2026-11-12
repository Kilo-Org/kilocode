export * as KiloCredential from "./credential.js"

/** The credential shapes the Kilo adapters read; the schema `Credential.Value` fits this structurally. */
export type Value =
  | { readonly type: "oauth"; readonly access: string }
  | { readonly type: "key"; readonly key: string }
  | { readonly type: "external" }

/** The bearer material of a Kilo credential, or undefined for an external source that owns the secret. */
export function token(credential: Value): string | undefined {
  if (credential.type === "oauth") return credential.access
  if (credential.type === "key") return credential.key
  return undefined
}
