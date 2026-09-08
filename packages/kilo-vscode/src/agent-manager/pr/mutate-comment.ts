import type { PRStatus } from "../types"
import { execGhInput } from "./PRActions"
import { GH_MUTATION_TIMEOUT } from "./pr-constants"

/** Resolve IDs and comment kinds only from the host's PR snapshot. */
export async function mutateComment(m: Record<string, unknown>, pr: PRStatus, cwd: string): Promise<void> {
  const { action, issue, id } = target(m, pr)
  const operation =
    action === "create"
      ? "addComment"
      : `${action === "edit" ? "update" : "delete"}${issue ? "IssueComment" : "PullRequestReviewComment"}`
  const field = action === "create" ? "subjectId" : issue || action === "delete" ? "id" : "pullRequestReviewCommentId"
  const selection =
    action === "delete"
      ? "clientMutationId"
      : action === "create"
        ? "commentEdge { node { id } }"
        : issue
          ? "issueComment { id }"
          : "pullRequestReviewComment { id }"
  const query = `mutation($id: ID!${action === "delete" ? "" : ", $body: String!"}) {
    ${operation}(input: { ${field}: $id${action === "delete" ? "" : ", body: $body"} }) { ${selection} }
  }`
  const { stdout } = await execGhInput(
    ["api", "graphql", "--method", "POST"],
    { query, variables: { id, ...(action === "delete" ? {} : { body: m.body }) } },
    { cwd, timeout: GH_MUTATION_TIMEOUT },
  )
  validate(stdout, operation, action, !!issue, id)
}

function target(m: Record<string, unknown>, pr: PRStatus) {
  if (m.prNumber !== pr.number || m.prUrl !== pr.url) throw new Error("Pull request changed. Refresh and try again.")
  const action = m.action
  if (action !== "create" && action !== "edit" && action !== "delete") throw new Error("Invalid comment action.")
  if (action !== "delete" && (typeof m.body !== "string" || !m.body.trim())) {
    throw new Error("Comment cannot be blank.")
  }
  const issue = pr.conversation?.find((comment) => comment.id === m.commentId && comment.kind === "issue")
  const review = pr.comments?.comments
    .flatMap((comment) => [comment, ...(comment.replies ?? [])])
    .find((comment) => comment.id && comment.id === m.commentId)
  const comment = issue ?? review
  if (action !== "create" && (!comment || comment[action === "edit" ? "canEdit" : "canDelete"] !== true)) {
    throw new Error("Comment not found or you do not have permission to change it.")
  }
  const id = action === "create" ? pr.id : comment?.id
  if (!id) throw new Error("Pull request metadata is unavailable. Refresh and try again.")
  return { action, issue, id }
}

function validate(stdout: string, operation: string, action: string, issue: boolean, id: string) {
  const result = JSON.parse(stdout) as {
    errors?: { message?: string }[]
    data?: Record<
      string,
      {
        clientMutationId?: string | null
        commentEdge?: { node?: { id?: string } }
        issueComment?: { id?: string }
        pullRequestReviewComment?: { id?: string }
      } | null
    >
  }
  if (result.errors?.length) throw new Error(result.errors.map((err) => err.message ?? "GraphQL error").join("; "))
  const payload = result.data?.[operation]
  const valid =
    action === "delete"
      ? payload?.clientMutationId === null
      : action === "create"
        ? payload?.commentEdge?.node?.id
        : issue
          ? payload?.issueComment?.id
          : payload?.pullRequestReviewComment?.id
  if (!valid || (action !== "delete" && (typeof valid !== "string" || (action === "edit" && valid !== id)))) {
    throw new Error("Invalid comment mutation response")
  }
}
