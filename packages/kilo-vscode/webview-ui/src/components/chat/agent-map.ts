/**
 * Shape the agent map the extension sends into the tree the dialog draws.
 *
 * The extension sends a flat node list with parent links, root first. The
 * dialog draws the root on the left and each generation in a column to its
 * right, like an org chart turned on its side.
 */

import type { AgentMap, AgentMapNode, AgentMapTokens } from "../../types/messages"

/**
 * The child IDs of each node reachable from the root, in the order the
 * extension sent them. IDs, not nodes, so a list keyed by value keeps its
 * rows across polls. A node that the root cannot reach, or that `keep` does
 * not hold, is left out.
 */
export function tree(map: AgentMap, keep?: ReadonlySet<string>): Map<string, string[]> {
  const kids = new Map<string, string[]>()
  for (const node of map.nodes) {
    if (!node.parent) continue
    kids.set(node.parent, [...(kids.get(node.parent) ?? []), node.id])
  }
  const result = new Map<string, string[]>()
  if (!map.nodes.some((node) => node.id === map.root)) return result
  // The extension places every node once, but a malformed map must not loop.
  const seen = new Set([map.root])
  const queue = [map.root]
  for (const id of queue) {
    const next = (kids.get(id) ?? []).filter((kid) => !seen.has(kid) && (!keep || keep.has(kid)))
    for (const kid of next) seen.add(kid)
    result.set(id, next)
    queue.push(...next)
  }
  return result
}

/** Working or blocked on the user: the node still needs attention. */
export function live(node: AgentMapNode) {
  return node.status === "running" || node.status === "waiting"
}

/**
 * The nodes to draw when finished ones are hidden. A node that still works
 * keeps the chain that started it, finished or not, so the tree stays
 * connected. The root always shows.
 */
export function active(map: AgentMap): Set<string> {
  const byId = new Map(map.nodes.map((node) => [node.id, node]))
  const keep = new Set([map.root])
  for (const node of map.nodes) {
    if (!live(node)) continue
    let id: string | undefined = node.id
    while (id && !keep.has(id)) {
      keep.add(id)
      id = byId.get(id)?.parent
    }
  }
  return keep
}

/**
 * What Stop all stops: the running agents below the root that no running
 * agent above them covers. Stopping an agent stops every subagent below it,
 * finished or not. An Agent Manager session is a root of its own, so a stop
 * above it does not reach it.
 */
export function stoppable(map: AgentMap): AgentMapNode[] {
  const byId = new Map(map.nodes.map((node) => [node.id, node]))
  const running = (node: AgentMapNode) => node.kind !== "root" && node.kind !== "process" && node.status === "running"
  const covered = (node: AgentMapNode) => {
    const seen = new Set<string>()
    let item: AgentMapNode | undefined = node
    while (item?.kind === "task" && item.parent && !seen.has(item.id)) {
      seen.add(item.id)
      const up = byId.get(item.parent)
      if (!up || up.kind === "root") return false
      if (running(up)) return true
      item = up
    }
    return false
  }
  return map.nodes.filter((node) => running(node) && !covered(node))
}

export function count(map: AgentMap) {
  const agents = map.nodes.filter((node) => node.kind === "task" || node.kind === "session")
  const processes = map.nodes.filter((node) => node.kind === "process")
  return {
    agents: agents.length,
    processes: processes.length,
    running: [...agents, ...processes].filter(live).length,
  }
}

/** Every token the node processed, cache included, as one number. */
export function total(tokens: AgentMapTokens | undefined) {
  if (!tokens) return 0
  return tokens.input + tokens.output + tokens.reasoning + tokens.cache.read + tokens.cache.write
}

/** How long the node has worked, or worked in total once it finished. */
export function elapsed(node: AgentMapNode, now: number) {
  return Math.max(0, (node.finished ?? now) - node.started)
}
