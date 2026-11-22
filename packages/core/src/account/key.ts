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
 * user id, so the key carries both: the normalized URL, percent-encoded (which
 * escapes the separator), joined with the remote id. The mapping is injective and
 * the key is never parsed back.
 */
export const accountKey = (url: string, remote: string): AccountV2.ID =>
  AccountV2.ID.make(`${encodeURIComponent(normalizeServerUrl(url))}:${remote}`)
