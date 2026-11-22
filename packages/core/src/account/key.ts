// kilocode_change - new file
import { AccountV2 } from "../account"

/** Reduce a console server address to the origin and path that identify it. */
export const normalizeServerUrl = (input: string): string => {
  const url = new URL(input)
  url.search = ""
  url.hash = ""

  const pathname = url.pathname.replace(/\/+$/, "")
  return pathname.length === 0 ? url.origin : `${url.origin}${pathname}`
}

/**
 * Local account key. A stored account belongs to one server and one server-issued
 * user id, so the key carries both: the percent-encoded server address (which
 * escapes the separator), joined with the remote id. The mapping is injective and
 * the key is never parsed back. `server` must already be normalized by
 * `normalizeServerUrl`, so a caller that must keep an unparseable stored address
 * can pass that raw address here without this key derivation throwing again.
 */
export const accountKey = (server: string, remote: string): AccountV2.ID =>
  AccountV2.ID.make(`${encodeURIComponent(server)}:${remote}`)
