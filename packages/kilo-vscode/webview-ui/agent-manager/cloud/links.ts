const loopback = new Set(["localhost", "127.0.0.1", "0.0.0.0", "[::1]", "[::]"])

/** Remote loopback links address the sandbox, not a VS Code service on this machine. */
export function cloudLink(uri: string) {
  const url = URL.parse(uri)
  if (!url || !["https:", "http:"].includes(url.protocol) || url.username || url.password) return
  if (!loopback.has(url.hostname)) return { kind: "external" as const, url: url.href }
  const port = Number(url.port)
  if (port < 1024 || port > 65535) return
  const path = url.pathname + url.search + url.hash
  return { kind: "preview" as const, port, path: path.length > 2048 ? "/" : path }
}
