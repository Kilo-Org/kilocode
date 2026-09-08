import { execGhRead } from "../gh"
import { GH_MUTATION_TIMEOUT } from "./pr-constants"
import { PR_REACTION_CONTENT, type PRReactionContent } from "../../../webview-ui/agent-manager/pr/pr-types"

const REACTION_CONTENT = new Set<string>(PR_REACTION_CONTENT)

export function isPRReactionContent(value: unknown): value is PRReactionContent {
  return typeof value === "string" && REACTION_CONTENT.has(value)
}

async function mutateReaction(subjectId: string, content: PRReactionContent, add: boolean, cwd: string): Promise<void> {
  const name = add ? "addReaction" : "removeReaction"
  const mutation = `mutation($subjectId: ID!, $content: ReactionContent!) {
    ${name}(input: { subjectId: $subjectId, content: $content }) {
      reaction { content }
    }
  }`
  try {
    const { stdout } = await execGhRead(
      ["api", "graphql", "-f", `query=${mutation}`, "-F", `subjectId=${subjectId}`, "-F", `content=${content}`],
      { cwd, timeout: GH_MUTATION_TIMEOUT },
    )
    const result = JSON.parse(stdout) as { errors?: { message?: string }[] }
    if (result.errors?.length) {
      throw new Error(result.errors.map((error) => error.message ?? "GraphQL error").join("; "))
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    const stderr = (err as Record<string, unknown>).stderr
    throw new Error(`Could not ${add ? "add" : "remove"} reaction: ${msg}${stderr ? `; ${stderr}` : ""}`)
  }
}

export function addCommentReaction(subjectId: string, content: PRReactionContent, cwd: string): Promise<void> {
  return mutateReaction(subjectId, content, true, cwd)
}

export function removeCommentReaction(subjectId: string, content: PRReactionContent, cwd: string): Promise<void> {
  return mutateReaction(subjectId, content, false, cwd)
}

export async function resolveComment(threadId: string, cwd: string): Promise<void> {
  const mutation = `mutation($id: ID!) { resolveReviewThread(input: { threadId: $id }) { thread { isResolved } } }`
  try {
    await execGhRead(["api", "graphql", "-f", `query=${mutation}`, "-F", `id=${threadId}`], {
      cwd,
      timeout: GH_MUTATION_TIMEOUT,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    const stderr = (err as Record<string, unknown>).stderr
    throw new Error(`Could not resolve thread: ${msg}${stderr ? ` — ${stderr}` : ""}`)
  }
}

export async function unresolveComment(threadId: string, cwd: string): Promise<void> {
  const mutation = `mutation($id: ID!) { unresolveReviewThread(input: { threadId: $id }) { thread { isResolved } } }`
  try {
    await execGhRead(["api", "graphql", "-f", `query=${mutation}`, "-F", `id=${threadId}`], {
      cwd,
      timeout: GH_MUTATION_TIMEOUT,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    const stderr = (err as Record<string, unknown>).stderr
    throw new Error(`Could not unresolve thread: ${msg}${stderr ? ` — ${stderr}` : ""}`)
  }
}
