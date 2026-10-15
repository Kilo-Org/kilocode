export * as KiloHeaders from "./headers.js"

export const HEADER_ORGANIZATION = "X-KILOCODE-ORGANIZATIONID"
export const HEADER_EDITOR = "X-KILOCODE-EDITORNAME"
export const HEADER_FEATURE = "X-KILOCODE-FEATURE"

export interface Options {
  readonly version: string
  readonly organizationID?: string | null
}

// Provider-level attribution headers from v1 (`packages/opencode/src/kilocode/const.ts` and
// `packages/kilo-gateway/src/headers.ts`). Per-request task/project/machine headers belong to PR 3.
export function provider(options: Options, env: Record<string, string | undefined> = process.env): Record<string, string> {
  return {
    "HTTP-Referer": "https://kilocode.ai",
    "X-Title": "Kilo Code",
    [HEADER_EDITOR]: env.KILOCODE_EDITOR_NAME || `Kilo CLI ${env.KILOCODE_VERSION || options.version}`,
    [HEADER_FEATURE]: env.KILOCODE_FEATURE || "cli",
    ...(options.organizationID ? { [HEADER_ORGANIZATION]: options.organizationID } : {}),
  }
}
