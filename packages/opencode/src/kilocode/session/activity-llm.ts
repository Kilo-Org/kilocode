import type { LanguageModelMiddleware, Tool } from "ai"
import type { LanguageModelV3StreamPart } from "@ai-sdk/provider"
import { Activity, type Request } from "./activity"

export function middleware(request: Request | undefined): LanguageModelMiddleware {
  return {
    specificationVersion: "v3",
    async wrapStream({ doStream }) {
      Activity.start(request)
      const result = await doStream()
      if (!request?.live) return result
      let complete = false
      return {
        ...result,
        stream: result.stream.pipeThrough(
          new TransformStream<LanguageModelV3StreamPart, LanguageModelV3StreamPart>({
            transform(chunk, controller) {
              if (chunk.type === "tool-call" && !chunk.providerExecuted) Activity.reserve(request, chunk.toolCallId)
              if (chunk.type === "finish") complete = true
              controller.enqueue(chunk)
            },
            flush() {
              if (complete) Activity.finish(request)
            },
          }),
        ),
      }
    },
  }
}

function iterable(value: unknown): value is AsyncIterable<unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    Symbol.asyncIterator in value &&
    typeof value[Symbol.asyncIterator] === "function"
  )
}

export function tools(request: Request | undefined, tools: Record<string, Tool>): Record<string, Tool> {
  if (!request?.live) return tools
  return Object.fromEntries(
    Object.entries(tools).map(([name, tool]) => {
      const execute = tool.execute
      if (!execute) return [name, tool]
      return [
        name,
        {
          ...tool,
          execute(input, options) {
            Activity.reserve(request, options.toolCallId)
            const finish = () => Activity.settle(request, options.toolCallId)
            try {
              const result = execute(input, options)
              if (iterable(result))
                return (async function* () {
                  try {
                    yield* result
                  } finally {
                    finish()
                  }
                })()
              return Promise.resolve(result).finally(finish)
            } catch (error) {
              finish()
              throw error
            }
          },
        } satisfies Tool,
      ]
    }),
  )
}

export * as ActivityLLM from "./activity-llm"
