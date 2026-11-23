/**
 * A recovery path shown under a `SessionIssue` provider group in the prompt
 * area's warning icon menu.
 */
export interface SessionIssueAction {
  title: string
  description?: string
  enabled?: boolean
  run: () => void
}

/**
 * An actionable problem scoped to one chat session. Deliberately generic —
 * no severity field, since there is one visual severity today (the warning
 * icon is fixed at the component level) — so the model can host future
 * non-MCP issue providers.
 */
export interface SessionIssue {
  id: string
  title: string
  actions: SessionIssueAction[]
}

function capitalize(name: string): string {
  if (!name) return name
  return name[0]!.toUpperCase() + name.slice(1)
}

/**
 * Derive one `SessionIssue` per MCP server that needs sign-in, sorted by
 * name for a deterministic menu order.
 */
export function mcpAuthIssues(
  needsAuth: string[],
  busy: string[],
  t: (key: string, params?: Record<string, string>) => string,
  handlers: { signIn: (name: string) => void; openSettings: (name: string) => void },
): SessionIssue[] {
  const busySet = new Set(busy)
  return [...needsAuth].sort().map((name) => {
    const isBusy = busySet.has(name)
    return {
      id: `mcp-auth:${name}`,
      title: t("prompt.mcp.provider", { name: capitalize(name) }),
      actions: [
        {
          title: isBusy ? t("prompt.mcp.signIn.busy") : t("common.signIn"),
          enabled: !isBusy,
          run: () => handlers.signIn(name),
        },
        {
          title: t("prompt.mcp.openSettings"),
          run: () => handlers.openSettings(name),
        },
      ],
    }
  })
}
