// Lazy-loaded autocomplete tokenizers. Bundled into a separate CJS chunk (`dist/autocomplete-tokenizers.js`)
// so extension activation never parses 6+ MB of BPE vocabulary tables before the user triggers autocomplete.
import { encodingForModel } from "js-tiktoken"
import { llamaTokenizer } from "./llamaTokenizer.js"

export { encodingForModel, llamaTokenizer }

export type Tokenizers = {
  encodingForModel: typeof encodingForModel
  llamaTokenizer: typeof llamaTokenizer
}
