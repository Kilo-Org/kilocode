import { getGitChangesContext } from "../services/git/context"

type Input = {
  requestId: string
  dir: string
  base?: string
  post: (message: unknown) => void
  error: (error: unknown) => string
}

export async function captureGitChangesContext(input: Input): Promise<void> {
  try {
    const output = await getGitChangesContext(input.dir, input.base)
    input.post({
      type: "gitChangesContextResult",
      requestId: input.requestId,
      content: output.content,
      truncated: output.truncated,
    })
  } catch (error) {
    console.error("[Kilo New] Failed to capture git changes context:", error)
    input.post({
      type: "gitChangesContextError",
      requestId: input.requestId,
      error: input.error(error) || "Failed to capture git changes",
    })
  }
}
