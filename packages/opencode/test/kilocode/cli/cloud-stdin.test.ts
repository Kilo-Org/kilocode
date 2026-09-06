import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import yargs from "yargs"
import { CloudSendCommand, CloudStartCommand } from "../../../src/kilocode/cli/cmd/cloud"
import { readCloudPromptStdin, resolveCloudPrompt, withCloudPrompt } from "../../../src/kilocode/cli/cmd/cloud-stdin"

const encoder = new TextEncoder()

function stream(parts: string[]) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const part of parts) controller.enqueue(encoder.encode(part))
      controller.close()
    },
  })
}

async function parse(command: typeof CloudStartCommand | typeof CloudSendCommand, argv: string[]) {
  return await command.builder!(yargs([]).exitProcess(false)).parseAsync(argv)
}

describe("Cloud prompt stdin", () => {
  test("preserves argv prompts for start and send", async () => {
    const start = await parse(CloudStartCommand, ["--prompt", "start from argv"])
    const send = await parse(CloudSendCommand, ["--session-id", "ses_123", "--prompt", "send from argv"])

    expect(await Effect.runPromise(resolveCloudPrompt(start))).toBe("start from argv")
    expect(await Effect.runPromise(resolveCloudPrompt(send))).toBe("send from argv")
  })

  test("accepts stdin prompts for start and send", async () => {
    const start = await parse(CloudStartCommand, ["--prompt-stdin"])
    const send = await parse(CloudSendCommand, ["--session-id", "ses_123", "--prompt-stdin"])

    expect(await Effect.runPromise(resolveCloudPrompt(start, stream(["start from stdin"])))).toBe("start from stdin")
    expect(await Effect.runPromise(resolveCloudPrompt(send, stream(["send from stdin"])))).toBe("send from stdin")
  })

  test("rejects conflicting and missing prompt selectors", async () => {
    await expect(parse(CloudStartCommand, ["--prompt", "argv", "--prompt-stdin"])).rejects.toThrow(
      "Provide exactly one of --prompt or --prompt-stdin",
    )
    await expect(parse(CloudStartCommand, [])).rejects.toThrow("Provide exactly one of --prompt or --prompt-stdin")
  })

  test("rejects empty and oversized stdin before admission", async () => {
    let calls = 0
    const admit = () => {
      calls += 1
      return Effect.void
    }

    await expect(Effect.runPromise(withCloudPrompt({ promptStdin: true }, admit, stream([])))).rejects.toMatchObject({
      message: "Cloud Agent prompt is invalid",
    })
    await expect(
      Effect.runPromise(withCloudPrompt({ promptStdin: true }, admit, stream(["x".repeat(100_001)]))),
    ).rejects.toMatchObject({ message: "Cloud Agent prompt is invalid" })
    expect(calls).toBe(0)
  })

  test("accepts the exact prompt boundary", async () => {
    const prompt = "x".repeat(100_000)
    expect(await readCloudPromptStdin(stream([prompt]))).toBe(prompt)
  })

  test("preserves Unicode split across byte chunks", async () => {
    const value = "before \uD83D\uDE80 after"
    const bytes = encoder.encode(value)
    const input = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, 8))
        controller.enqueue(bytes.slice(8, 10))
        controller.enqueue(bytes.slice(10))
        controller.close()
      },
    })

    expect(await readCloudPromptStdin(input)).toBe(value)
  })
})
