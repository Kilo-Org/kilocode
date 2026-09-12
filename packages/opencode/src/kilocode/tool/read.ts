import type * as Tool from "@/tool/tool"

export function context<M extends object>(ctx: Tool.Context<M>, reason?: string): Tool.Context<M> {
  const description = reason?.trim() || "Read content needed for the current task"
  return {
    ...ctx,
    ask: (request) => ctx.ask({ ...request, metadata: { ...request.metadata, description } }),
  }
}
