export * as KiloHeaders from "./headers.js"

export const ORGANIZATION = "X-KILOCODE-ORGANIZATIONID"
export const EDITOR_NAME = "X-KILOCODE-EDITORNAME"
export const FEATURE = "X-KILOCODE-FEATURE"

/**
 * Headers for every Gateway request of a client. Hosts override the defaults with the v1 variables
 * `KILOCODE_VERSION`, `KILOCODE_EDITOR_NAME` (used as is) and `KILOCODE_FEATURE`.
 */
export function provider(
  input: { readonly version: string; readonly organizationID?: string | null },
  env: Record<string, string | undefined> = process.env,
): Record<string, string> {
  return {
    "HTTP-Referer": "https://kilocode.ai",
    "X-Title": "Kilo Code",
    [EDITOR_NAME]: env.KILOCODE_EDITOR_NAME || `Kilo CLI ${env.KILOCODE_VERSION || input.version}`,
    [FEATURE]: env.KILOCODE_FEATURE || "cli",
    ...(input.organizationID ? { [ORGANIZATION]: input.organizationID } : {}),
  }
}
