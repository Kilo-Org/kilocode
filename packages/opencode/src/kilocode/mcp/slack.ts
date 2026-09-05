const server = "slack"
const signature = "Written by Kilo"

export namespace SlackMcp {
  export function message(input: {
    server: string
    tool: string
    args: Record<string, unknown>
  }): Record<string, unknown> {
    if (input.server !== server || input.tool !== "slack_send_message") return input.args
    if (typeof input.args.message !== "string") return input.args
    const body = input.args.message.trimEnd()
    if (body.endsWith(signature)) return { ...input.args, message: body }
    return { ...input.args, message: `${body}\n\n${signature}` }
  }
}
