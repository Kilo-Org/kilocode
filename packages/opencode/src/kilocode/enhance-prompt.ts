import { Provider } from "@/provider/provider"
import { LLM } from "@/session/llm"
import { Agent } from "@/agent/agent"
import { Log } from "@/util/log"

const log = Log.create({ service: "enhance-prompt" })

export function clean(text: string) {
  const stripped = text.replace(/^```\w*\n?|```$/g, "").trim()
  return stripped.replace(/^(['"])([\s\S]*)\1$/, "$2").trim()
}

export async function enhancePrompt(text: string): Promise<string> {
  log.info("enhancing", { length: text.length })

  const defaultModel = await Provider.defaultModel()
  const model =
    (await Provider.getSmallModel(defaultModel.providerID)) ??
    (await Provider.getModel(defaultModel.providerID, defaultModel.modelID))

  const agent: Agent.Info = {
    name: "enhance-prompt",
    mode: "primary",
    hidden: true,
    options: {},
    permission: [],
    prompt: "Generate an enhanced version of this prompt (reply with only the enhanced prompt - no conversation, explanations, lead-in, bullet points, placeholders, or surrounding quotes):",
    temperature: 0.7,
  }

  const stream = await LLM.stream({
    agent,
    user: {
      id: "enhance-prompt",
      sessionID: "enhance-prompt",
      role: "user",
      model: {
        providerID: model.providerID,
        modelID: model.id,
      },
      time: {
        created: Date.now(),
        completed: Date.now(),
      },
    } as any,
    tools: {},
    model,
    small: true,
    messages: [{ role: "user" as const, content: text }],
    abort: new AbortController().signal,
    sessionID: "enhance-prompt",
    system: [],
    retries: 3,
  })

  const result = await stream.text
  log.info("enhanced", { length: result.length })
  return clean(result)
}
