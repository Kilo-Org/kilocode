import type * as Tool from "@/tool/tool"
import * as ToolJsonSchema from "@/tool/json-schema"
import type { Schema } from "effect"

export function schema(parameters: Schema.Top) {
  const value = ToolJsonSchema.fromSchema(parameters)
  return { ...value, required: [...new Set([...(value.required ?? []), "description"])] }
}

export function context<M extends object>(ctx: Tool.Context<M>, reason?: string): Tool.Context<M> {
  const description = reason?.trim()
  return {
    ...ctx,
    ask: (request) =>
      ctx.ask({ ...request, metadata: description ? { ...request.metadata, description } : request.metadata }),
  }
}
