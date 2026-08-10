import { execGhRead } from "../gh"

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
