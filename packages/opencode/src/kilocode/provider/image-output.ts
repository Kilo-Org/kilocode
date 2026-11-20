import type { Provider } from "@/provider/provider"

/**
 * OpenRouter-compatible chat endpoints (OpenRouter and the Kilo Gateway) only return
 * generated images when the request asks for the image output modality. Without it,
 * image models such as Gemini "Nano Banana" answer with text only.
 *
 * Routers such as `openrouter/auto` advertise image output because they can pick an image
 * model; requesting images from them would steer ordinary chat turns to image models.
 */
const NPM = new Set(["@openrouter/ai-sdk-provider", "@kilocode/kilo-gateway"])

export function imageModalities(model: Provider.Model) {
  if (!NPM.has(model.api.npm)) return
  if (!model.capabilities.output.image) return
  if (model.api.id.startsWith("openrouter/")) return
  return ["image", "text"]
}
