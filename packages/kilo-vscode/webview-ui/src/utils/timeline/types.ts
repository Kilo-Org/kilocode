/** One renderable assistant content item, in the v2 session message shape. */
export type TimelinePart =
  | { type: "text"; key: string; messageID: string; text: string }
  | { type: "reasoning"; key: string; messageID: string; text: string }
  | {
      type: "tool"
      key: string
      messageID: string
      name: string
      status: "streaming" | "running" | "completed" | "error"
      input: unknown
      outputLength: number
    }
