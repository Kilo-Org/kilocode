export const endpoint = "https://mcp.slack.com/mcp"
const signature = "Written by Kilo"
const limit = 500

function text(value: unknown) {
  if (typeof value !== "string" && typeof value !== "number") return
  const clean = String(value).trim()
  if (!clean) return
  if (clean.length <= limit) return clean
  return `${clean.slice(0, limit - 1)}…`
}

function target(args: Record<string, unknown>) {
  return text(args.channel_id) ?? text(args.user_id) ?? text(args.channel) ?? "Slack"
}

export namespace SlackMcp {
  export function permission(input: { url?: string; tool: string; args: Record<string, unknown> }): {
    patterns: string[]
    always: string[]
    metadata: Record<string, unknown>
  } {
    if (input.url !== endpoint) return { patterns: ["*"], always: ["*"], metadata: {} }

    const query = text(input.args.query)
    const message = text(input.args.message)
    const channel = target(input.args)

    if (input.tool === "slack_send_message") {
      return {
        patterns: [`Post to ${channel}:\n\n${message ?? "(empty message)"}`],
        always: [],
        metadata: { disableAlways: true },
      }
    }
    if (input.tool === "slack_schedule_message") {
      const time = text(input.args.post_at) ?? "the requested time"
      return {
        patterns: [`Schedule for ${channel} at ${time}:\n\n${message ?? "(empty message)"}`],
        always: [],
        metadata: { disableAlways: true },
      }
    }
    if (input.tool === "slack_send_message_draft") {
      return {
        patterns: [`Save draft for ${channel}:\n\n${message ?? "(empty message)"}`],
        always: ["*"],
        metadata: {},
      }
    }
    if (query) return { patterns: [`Search Slack for: ${query}`], always: ["*"], metadata: {} }

    const args = Object.entries(input.args)
      .flatMap(([key, value]) => {
        const item = text(value)
        return item ? [`${key}: ${item}`] : []
      })
      .slice(0, 4)
    return {
      patterns: args.length ? [`Use ${input.tool}\n${args.join("\n")}`] : [`Use ${input.tool}`],
      always: ["*"],
      metadata: {},
    }
  }

  export function message(input: {
    url?: string
    tool: string
    args: Record<string, unknown>
  }): Record<string, unknown> {
    if (input.url !== endpoint || input.tool !== "slack_send_message") return input.args
    if (typeof input.args.message !== "string") return input.args
    const body = input.args.message.trimEnd()
    if (body.endsWith(signature)) return { ...input.args, message: body }
    return { ...input.args, message: `${body}\n\n${signature}` }
  }
}
