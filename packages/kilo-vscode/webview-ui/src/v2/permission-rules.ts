import type { OpenCodeClient, PermissionRequest } from "@opencode/client"

const NAVIGATE = "navigate:"

/** browser_open rules carry a "navigate:" prefix so they match an origin. Hide it in the UI; the saved rule keeps it. */
export function displayResource(action: string, resource: string) {
  if (action !== "browser_open" || !resource.startsWith(NAVIGATE)) return resource
  return resource.slice(NAVIGATE.length)
}

/**
 * The broader rule a request offers next to the one "Allow always" saves. browser_open lists its origin and
 * "navigate:*" in `metadata.rules`; only the origin travels in `save`, so a plain approval never allows every site.
 */
export function widerRule(request: PermissionRequest) {
  const rules = request.metadata?.rules
  if (request.action !== "browser_open" || !Array.isArray(rules)) return undefined
  const save = request.save ?? []
  return rules.find((rule): rule is string => typeof rule === "string" && !save.includes(rule))
}

/**
 * A reply saves exactly the request's `save` rules, so a broader choice replies "always" and then rewrites the saved
 * origin rule to the broader one. When the project already saved the broader rule, the origin rule stays as it is.
 */
export async function widenSaved(
  saved: Pick<OpenCodeClient["permission"]["saved"], "list" | "update">,
  input: { projectID: string; action: string; from: string; to: string },
) {
  const rows = await saved.list({ projectID: input.projectID })
  const same = (resource: string) => (row: (typeof rows)[number]) =>
    row.action === input.action && row.resource === resource
  const origin = rows.find(same(input.from))
  if (!origin || rows.some(same(input.to))) return
  await saved.update({ id: origin.id, resource: input.to })
}
