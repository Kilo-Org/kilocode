import { createClient } from "@kilocode/client"
import { constants } from "node:fs"
import { open } from "node:fs/promises"
import { CloudRpc } from "./cloud-rpc"
import { AgentStartRequestSchema, resultExitCode } from "./cloud/contracts"

type CloudCommand =
  | { action: "start"; file: string; stream?: boolean }
  | { action: "send"; cloudAgentSessionId: string; prompt: string }
  | { action: "status" | "result"; cloudAgentSessionId: string; messageId: string }

export async function executeCloudCommand(
  client: ReturnType<typeof createClient>,
  command: CloudCommand,
  signal?: AbortSignal,
) {
  const location = { directory: process.cwd() }
  const request = { location, signal }
  await client.plugin.awaitActivation({ location }, { signal })
  const rpc = client.rpc(CloudRpc.Definition)
  if (command.action === "start" || command.action === "send") {
    const result =
      command.action === "start"
        ? await rpc.start(
            { ...(await readStart(command.file, signal)), options: { createdOnPlatform: "kilo-cli" } },
            request,
          )
        : await rpc.send(
            { cloudAgentSessionId: command.cloudAgentSessionId, message: { prompt: command.prompt } },
            request,
          )
    return {
      output: {
        cloudAgentSessionId: result.cloudAgentSessionId,
        messageId: result.messageId,
        delivery: result.delivery,
      },
      exitCode: 0,
      // Defer streaming until the caller has printed the safe admission. A
      // failed stream cannot undo an already accepted remote prompt.
      stream:
        command.action === "start" && command.stream
          ? async (writeLine: (line: string) => void | Promise<void>) => {
              const prepared = await rpc["stream.prepare"](
                { cloudAgentSessionId: result.cloudAgentSessionId, streamUrl: result.streamUrl },
                request,
              )
              const { streamAgentEvents } = await import("./cloud/websocket-stream")
              await streamAgentEvents({ ...prepared, writeLine, signal })
            }
          : undefined,
    }
  }
  const input = { cloudAgentSessionId: command.cloudAgentSessionId, messageId: command.messageId }
  const output = command.action === "status" ? await rpc.status(input, request) : await rpc.result(input, request)
  return { output, exitCode: command.action === "result" ? resultExitCode(output.status) : 0 }
}

async function readStart(file: string, signal?: AbortSignal) {
  signal?.throwIfAborted()
  const handle = await open(file, constants.O_RDONLY | constants.O_NONBLOCK)
  try {
    const info = await handle.stat()
    const limit = 1024 * 1024
    if (!info.isFile() || info.size > limit) throw new Error("Cloud request must be a regular file of at most 1 MiB")
    const buffer = Buffer.alloc(limit + 1)
    let size = 0
    while (size < buffer.length) {
      signal?.throwIfAborted()
      const read = await handle.read(buffer, size, buffer.length - size)
      if (!read.bytesRead) break
      size += read.bytesRead
    }
    if (size > limit) throw new Error("Cloud request exceeds 1 MiB")
    const parsed = AgentStartRequestSchema.omit({ options: true }).safeParse(
      JSON.parse(buffer.toString("utf8", 0, size)),
    )
    if (!parsed.success) throw new Error("Invalid cloud start request")
    return parsed.data
  } catch {
    // Neither JSON syntax nor schema diagnostics may echo prompts or repository tokens.
    throw new Error("Cloud start requires a valid local request JSON file of at most 1 MiB")
  } finally {
    await handle.close()
  }
}
