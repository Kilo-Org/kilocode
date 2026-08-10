/**
 * PR write actions — resolve comments, merge, approve, re-run checks.
 * Keeps AgentManagerProvider.ts under its line cap.
 */
import { execGhRead } from "./gh"

type RepoInfo = { owner: string; name: string }

async function repoInfo(cwd: string): Promise<RepoInfo> {
  const { stdout } = await execGhRead(["repo", "view", "--json", "owner,name"], { cwd, timeout: 10_000 })
  const data = JSON.parse(stdout)
  return { owner: data.owner.login as string, name: data.name as string }
}

/**
 * Resolve a PR review thread by its node ID via GitHub GraphQL.
 * Returns an error string on failure, undefined on success.
 */
export async function resolveComment(threadId: string, cwd: string): Promise<string | undefined> {
  const mutation = `mutation($id: ID!) { resolveReviewThread(input: { threadId: $id }) { thread { isResolved } } }`
  const { stdout } = await execGhRead(
    ["api", "graphql", "-f", `query=${mutation}`, "-F", `id=${threadId}`],
    { cwd, timeout: 15_000 },
  )
  const result = JSON.parse(stdout)
  if (result.errors?.length) return (result.errors[0]?.message as string) ?? "GraphQL error"
  return undefined
}

export { repoInfo }
