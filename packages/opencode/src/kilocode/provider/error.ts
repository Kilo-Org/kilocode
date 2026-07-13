import type { APICallError } from "ai"
import { ProviderID } from "@/provider/schema"

const AUTH_ERROR =
  "Request had invalid authentication credentials. Expected OAuth 2 access token, login cookie or other valid authentication credential. See https://developers.google.com/identity/sign-in/web/devconsole-project."

export function hint(provider: ProviderID, error: APICallError) {
  if (provider !== ProviderID.google) return
  if (error.statusCode !== 401) return
  if (error.message !== AUTH_ERROR) return

  return "Google Gemini rejected this API key. Check its type and status in Google AI Studio. Replace a Standard key with a new auth key; if it is already an auth key, check its Gemini API access or create a replacement. Restricted Standard keys work only until September 2026. See https://kilo.ai/docs/ai-providers/gemini."
}
