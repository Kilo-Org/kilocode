import type { Argv } from "yargs"
import { Effect } from "effect"
import { PromptSchema } from "@/kilocode/cloud/contracts"
import { CliError, fail } from "@/cli/effect-cmd"

const maximumCharacters = 100_000
const maximumBytes = maximumCharacters * 3
const invalidPrompt = "Cloud Agent prompt is invalid"
const promptSelection = "Provide exactly one of --prompt or --prompt-stdin"
type PromptStream = ReadableStream<Uint8Array<ArrayBufferLike>>

export interface CloudPromptArgs {
  prompt?: string
  promptStdin?: boolean
}

export function cloudPromptOptions(yargs: Argv) {
  return yargs
    .option("prompt", {
      type: "string",
      describe: "prompt for the Cloud Agent",
    })
    .option("prompt-stdin", {
      type: "boolean",
      default: false,
      describe: "read the prompt from standard input",
    })
    .check((args) => {
      const argv = typeof args.prompt === "string"
      const stdin = args.promptStdin === true
      if (argv && stdin) throw new Error(promptSelection)
      return true
    })
}

export const resolveCloudPrompt = Effect.fn("Cli.cloud.prompt")(function* (
  args: CloudPromptArgs,
  stream?: PromptStream,
) {
  const argv = typeof args.prompt === "string"
  const stdin = args.promptStdin === true
  if (argv === stdin) return yield* fail(promptSelection)

  const prompt = stdin
    ? yield* Effect.tryPromise({
        try: () => readCloudPromptStdin(stream),
        catch: () => new CliError({ message: invalidPrompt }),
      })
    : args.prompt

  if (typeof prompt !== "string" || !PromptSchema.safeParse(prompt).success) return yield* fail(invalidPrompt)
  return prompt
})

export function withCloudPrompt<A, E, R>(
  args: CloudPromptArgs,
  admit: (prompt: string) => Effect.Effect<A, E, R>,
  stream?: PromptStream,
) {
  return Effect.flatMap(resolveCloudPrompt(args, stream), admit)
}

export async function readCloudPromptStdin(stream: PromptStream = Bun.stdin.stream()): Promise<string> {
  const reader = stream.getReader()
  const decoder = new TextDecoder("utf-8", { fatal: true })
  const parts: string[] = []
  let bytes = 0
  let characters = 0
  let complete = false

  try {
    for (;;) {
      const next = await reader.read()
      if (next.done) {
        complete = true
        const text = decoder.decode()
        if (text.length > maximumCharacters - characters) throw new Error(invalidPrompt)
        return parts.join("") + text
      }

      bytes += next.value.byteLength
      if (bytes > maximumBytes) throw new Error(invalidPrompt)

      const text = decoder.decode(next.value, { stream: true })
      if (text.length > maximumCharacters - characters) throw new Error(invalidPrompt)
      characters += text.length
      parts.push(text)
    }
  } finally {
    if (!complete) await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
}
