import { generateText } from "ai"
import { mergeDeep } from "remeda"
import { Provider } from "@/provider"
import { ProviderTransform } from "@/provider"
import { Log } from "@/util"

const log = Log.create({ service: "enhance-prompt" })

const INSTRUCTION =
  "Generate an enhanced version of this prompt (reply with only the enhanced prompt - no conversation, explanations, lead-in, bullet points, placeholders, or surrounding quotes):"

export function clean(text: string) {
  const stripped = text.replace(/^```\w*\n?|```$/g, "").trim()
  return stripped.replace(/^(['"])([\s\S]*)\1$/, "$2").trim()
}

/**
 * Lightweight prompt enhancement that mirrors the legacy singleCompletionHandler.
 * Calls generateText directly — no agent identity, no system prompt, no tools,
 * no plugins. Just the bare instruction + user text as a single user message.
 */
export async function enhancePrompt(text: string): Promise<string> {
  log.info("enhancing", { length: text.length })

  const defaultModel = await Provider.defaultModel()
  const model =
    (await Provider.getSmallModel(defaultModel.providerID)) ??
    (await Provider.getModel(defaultModel.providerID, defaultModel.modelID))

  const language = await Provider.getLanguage(model)

  const result = await generateText({
    model: language,
    temperature: model.capabilities.temperature ? 0.7 : undefined,
    providerOptions: ProviderTransform.providerOptions(
      model,
      mergeDeep(ProviderTransform.smallOptions(model), model.options),
    ),
    maxRetries: 3,
    system: INSTRUCTION,
    messages: [{ role: "user" as const, content: text }],
  })

  log.info("enhanced", { length: result.text.length })
  return clean(result.text)
}
