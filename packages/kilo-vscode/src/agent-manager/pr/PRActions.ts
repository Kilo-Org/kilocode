import type { ExecFileOptionsWithStringEncoding } from "node:child_process"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { execGhRead } from "../gh"
import { GH_MUTATION_TIMEOUT } from "./pr-constants"
import { PR_REACTION_CONTENT, type PRReactionContent } from "../../../webview-ui/agent-manager/pr/pr-types"

const REACTION_CONTENT = new Set<string>(PR_REACTION_CONTENT)

export async function execGhInput(
  args: string[],
  input: Record<string, unknown>,
  options?: Omit<ExecFileOptionsWithStringEncoding, "encoding">,
): Promise<{ stdout: string; stderr: string }> {
  const dir = await mkdtemp(join(tmpdir(), "kilo-gh-"))
  const file = join(dir, "input.json")
  try {
    await writeFile(file, JSON.stringify(input), { encoding: "utf8", mode: 0o600 })
    return await execGhRead([...args, "--input", file], options)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

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

export async function replyComment(threadId: string, body: string, cwd: string): Promise<void> {
  const mutation = `mutation($id: ID!, $body: String!) {
    addPullRequestReviewThreadReply(input: { pullRequestReviewThreadId: $id, body: $body }) {
      comment { id }
    }
  }`
  const { stdout } = await execGhInput(
    ["api", "graphql", "--method", "POST"],
    { query: mutation, variables: { id: threadId, body } },
    { cwd, timeout: GH_MUTATION_TIMEOUT },
  )
  const result = JSON.parse(stdout) as {
    errors?: { message?: string }[]
    data?: { addPullRequestReviewThreadReply?: { comment?: { id?: string } } }
  }
  if (result.errors?.length) {
    throw new Error(result.errors.map((error) => error.message ?? "GraphQL error").join("; "))
  }
  if (!result.data?.addPullRequestReviewThreadReply?.comment?.id) throw new Error("Invalid PR reply response")
}

export function resolveComment(threadId: string, cwd: string): Promise<void> {
  return resolve("resolve", threadId, cwd)
}

export function unresolveComment(threadId: string, cwd: string): Promise<void> {
  return resolve("unresolve", threadId, cwd)
}

async function resolve(action: "resolve" | "unresolve", id: string, cwd: string): Promise<void> {
  const mutation = `mutation($id: ID!) { ${action}ReviewThread(input: { threadId: $id }) { thread { isResolved } } }`
  try {
    await execGhRead(["api", "graphql", "-f", `query=${mutation}`, "-F", `id=${id}`], {
      cwd,
      timeout: GH_MUTATION_TIMEOUT,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    const stderr = (err as Record<string, unknown>).stderr
    throw new Error(`Could not ${action} thread: ${msg}${stderr ? ` - ${stderr}` : ""}`)
  }
}
