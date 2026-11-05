export interface Endpoint {
  readonly url: URL
  readonly token: string
}

/**
 * Read the loopback broker endpoint a client prints into the server environment. A broker listens on loopback only,
 * so any other origin, a path, or credentials mean the value did not come from this host.
 */
export function readEndpoint(prefix: string): Endpoint | undefined {
  const base = process.env[`${prefix}_URL`]
  const token = process.env[`${prefix}_TOKEN`]
  if (!base || !token || !URL.canParse(base)) return undefined
  const url = new URL(base)
  if (
    url.protocol !== "http:" ||
    url.hostname !== "127.0.0.1" ||
    !url.port ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    return undefined
  }
  return { url, token }
}

/**
 * Read the endpoint once and remove it from the process environment. Tools and MCP servers inherit this
 * environment, so leaving the token there would let a shell command use the capability without the permission
 * prompt. The plugin effect runs again for each Location and after each plugin reload, so later calls return the
 * captured endpoint.
 */
export function takeEndpoint(prefix: string, captured: { endpoint?: Endpoint }): Endpoint | undefined {
  const endpoint = readEndpoint(prefix)
  if (!endpoint) return captured.endpoint
  captured.endpoint = endpoint
  delete process.env[`${prefix}_URL`]
  delete process.env[`${prefix}_TOKEN`]
  return endpoint
}
