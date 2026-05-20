/**
 * dag.ts — Topological sort + parallel DAG execution
 * Inspired by n8n WorkflowExecute (Apache-2.0)
 * Deps: none
 */

export type Edge = { from: string; to: string }

export function topologicalSort(nodes: string[], edges: Edge[]): string[] {
  const adj = new Map<string, string[]>()
  const inDeg = new Map<string, number>()
  for (const n of nodes) { adj.set(n, []); inDeg.set(n, 0) }
  for (const { from, to } of edges) {
    adj.get(from)!.push(to)
    inDeg.set(to, (inDeg.get(to) ?? 0) + 1)
  }
  const queue: string[] = []
  for (const [id, d] of inDeg) if (d === 0) queue.push(id)
  const order: string[] = []
  while (queue.length) {
    const cur = queue.shift()!
    order.push(cur)
    for (const next of adj.get(cur) ?? []) {
      inDeg.set(next, inDeg.get(next)! - 1)
      if (inDeg.get(next) === 0) queue.push(next)
    }
  }
  if (order.length !== nodes.length) throw new Error("Cycle detected in DAG")
  return order
}

export async function executeDag<T>(
  nodes: string[], edges: Edge[],
  exec: (id: string, inputs: Map<string, T>) => Promise<T>,
): Promise<Map<string, T>> {
  const results = new Map<string, T>()
  const deps = new Map<string, Set<string>>()
  for (const n of nodes) deps.set(n, new Set())
  for (const { from, to } of edges) deps.get(to)!.add(from)
  const done = new Set<string>()
  while (done.size < nodes.length) {
    const ready = nodes.filter(n => !done.has(n) && [...deps.get(n)!].every(d => done.has(d)))
    if (!ready.length) throw new Error("Cycle or blocked node")
    await Promise.all(ready.map(async id => {
      const inputs = new Map<string, T>()
      for (const dep of deps.get(id)!) inputs.set(dep, results.get(dep)!)
      results.set(id, await exec(id, inputs))
      done.add(id)
    }))
  }
  return results
}
