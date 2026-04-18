# Speech Synthesis Complete Coverage Spec

## Status: COMPLETE
This subsystem is fully implemented, tested, and released.
- **PR:** #8839
- **Release:** v7.2.5-speech

## Architecture
- SpeechProvider interface + SpeechProviderRegistry (Map-based, register/get/list/listByTier)
- 6 provider implementations under webview-ui/src/utils/speech-providers/
- Provider-agnostic playback engine (speech-playback.ts)
- 25-rule text filter with sentiment detection (speech-text-filter.ts)
- Settings UI (SpeechTab.tsx, Solid.js)

## Providers
| Provider | Tier | API | Auth | Free Allowance |
|----------|------|-----|------|----------------|
| Browser | free | Web Speech API | none | unlimited, offline |
| Azure | freeTier | REST + SSML | Ocp-Apim-Subscription-Key | 500K chars/month |
| Google Cloud TTS | freeTier | REST, base64 response | API key | 4M chars/month |
| OpenAI TTS | freeTier | REST | Bearer token | $5 free credit |
| ElevenLabs | freeTier | REST | xi-api-key | 10K chars/month |
| Amazon Polly | freeTier | REST | AWS access key + secret | 5M chars/month (12 mo) |

## SpeechProvider Interface
```typescript
interface SpeechProvider {
  id: string
  name: string
  tier: "free" | "freeTier"
  requiresApiKey: boolean
  description: string
  freeAllowance: string
  capabilities: {
    ssml: boolean
    styles: boolean
    emphasis: boolean
    pronunciations: boolean
    audioFormats: string[]
  }
  getVoices(): SpeechVoice[]
  synthesize(text: string, opts: SynthesisOptions): Promise<Blob | void>
  stop(): void
  testConnection?(apiKey: string, region?: string): Promise<boolean>
}
```

## Key Files
| File | Purpose |
|------|---------|
| webview-ui/src/types/voice.ts | Core type definitions |
| webview-ui/src/data/speech-providers.ts | Provider registry |
| webview-ui/src/utils/speech-providers/browser-provider.ts | Browser (Web Speech API) |
| webview-ui/src/utils/speech-providers/azure-provider.ts | Azure Cognitive Services |
| webview-ui/src/utils/speech-providers/google-provider.ts | Google Cloud TTS |
| webview-ui/src/utils/speech-providers/openai-provider.ts | OpenAI TTS |
| webview-ui/src/utils/speech-providers/elevenlabs-provider.ts | ElevenLabs |
| webview-ui/src/utils/speech-providers/polly-provider.ts | Amazon Polly |
| webview-ui/src/utils/speech-playback.ts | Playback engine + LRU cache |
| webview-ui/src/utils/speech-text-filter.ts | 25-rule text sanitization |
| webview-ui/src/components/settings/SpeechTab.tsx | Settings UI |
| src/webview-html-utils.ts | CSP connect-src for all providers |
| src/KiloProvider.ts | Settings wire-up |
| webview-ui/src/App.tsx | Auto-speak integration |

## Features
- Auto-speak (responses spoken when complete)
- Stop-on-typing (interrupt on user input)
- 3 interaction modes: Assist, Conversation, Minimal
- Sentiment detection (pitch/rate adapt to tone)
- Multi-voice dialogue
- Voice favorites and presets
- LRU synthesis cache (32 entries)
- Voice fine-tuning: pitch, rate, emphasis, sentence pause, paragraph break, pronunciations
- Audio quality selection (Standard 24kHz, High 48kHz)

## CSP Endpoints
connect-src includes: https://*.tts.speech.microsoft.com, https://texttospeech.googleapis.com, https://api.openai.com, https://api.elevenlabs.io, https://polly.*.amazonaws.com

## VS Code Configuration Keys (31 total)
Under `kilo-code.new.speech.*`: provider, azure.apiKey, azure.region, google.apiKey, openai.apiKey, elevenlabs.apiKey, polly.accessKeyId, polly.secretAccessKey, polly.region, enabled, voice, rate, pitch, volume, etc.

## Test Coverage
- 95 unit tests (bun:test)
  - speech-provider-registry: 5 tests
  - browser-provider: 9 tests
  - azure-provider: 11 tests
  - speech-text-filter: 70 tests
- 0 lint errors across 14 files
- AGENTS.md compliant (no let, no else, no any)

## Acceptance Criteria — ALL PASSED
- [x] Browser provider works with no API key
- [x] Azure provider connects with valid key
- [x] All 6 providers register in registry
- [x] Voice browser lists voices per provider
- [x] Play preview works for selected voice
- [x] Auto-speak triggers after AI response
- [x] Stop-on-typing interrupts playback
- [x] Text filter strips markdown/code/URLs
- [x] Sentiment detection adjusts voice parameters
- [x] CSP allows all provider endpoints
- [x] VSIX builds and installs cleanly
- [x] 95 unit tests pass
