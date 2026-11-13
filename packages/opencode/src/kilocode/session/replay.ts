import type { SessionV1 } from "@opencode-ai/core/v1/session"

// Blank text is not content worth replaying. An aborted turn that only opened
// a text block otherwise comes back as "" or " ", and Anthropic rejects that
// ("text content blocks must be non-empty"). The direct Anthropic and Bedrock
// Claude filters drop "", but the Kilo gateway, Vertex Anthropic, OpenRouter,
// and OpenAI-compatible routes do not, and every route keeps whitespace.
export namespace KiloReplay {
  export function replayable(part: SessionV1.Part) {
    if (part.type === "step-start" || part.type === "reasoning") return false
    if (part.type === "text" && part.text.trim() === "") return false
    return true
  }

  // Signed-reasoning turns still keep the single-space separator. Other blank
  // text on an aborted turn is dropped, including a blank part next to a real answer.
  export function omit(text: string, aborted: boolean, signed: boolean) {
    return aborted && text.trim() === "" && !signed
  }
}
