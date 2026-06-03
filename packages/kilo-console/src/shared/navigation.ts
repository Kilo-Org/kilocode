export type Path = "/projects" | "/project" | "/profile" | "/settings"

function base() {
  return (import.meta.env?.BASE_URL ?? "/").replace(/\/$/, "")
}

export function strip(input: string, prefix = base()) {
  if (!prefix || prefix === "/") return input
  if (input === prefix) return "/"
  if (input.startsWith(`${prefix}/`)) return input.slice(prefix.length)
  return input
}

export function settings(input: string, prefix = base()) {
  const route = strip(input, prefix)
  const index = route.indexOf("/settings")
  if (index > 0) return `${route.slice(0, index)}/settings`
  if (route.startsWith("/config")) return "/config"
  return "/settings"
}

export function path(input: string, prefix = base()): Path {
  const route = strip(input, prefix)
  if (route === "/profile") return "/profile"
  if (route.startsWith("/settings") || route.startsWith("/config")) return "/settings"
  if (route.startsWith("/projects/")) return "/project"
  return "/projects"
}
