# Multi-Provider Speech Synthesis — Design Document

**Date:** 2026-04-13
**Branch:** feat/azure-voice-studio (v2)
**Target:** PR to Kilo-Org/kilocode via AiDave71/kilocode fork

## Goal

Refactor the current Azure-only speech feature into a multi-provider architecture with Browser (free, offline) as default and 5 additional providers with free tiers. Match upstream code patterns for maximum merge acceptance.

## Providers

| Provider | Free Allowance | API Key | Offline | Voices | Fine-Tuning |
|----------|---------------|---------|---------|--------|-------------|
| Browser (Web Speech API) | Unlimited | No | Yes | OS-dependent (~20-50) | pitch, rate |
| Azure Cognitive Services | 500K chars/mo | Yes (free tier) | No | 125+ English, SSML | pitch, rate, style, emphasis, pronunciations, audio format |
| Google Cloud TTS | 4M chars/mo | Yes (free tier) | No | 40+ English, SSML | pitch (-20 to +20), rate (0.25-4.0), SSML |
| OpenAI TTS | $5 free credit | Yes | No | 6 fixed (alloy, echo, fable, onyx, nova, shimmer) | speed (0.25-4.0) |
| ElevenLabs | 10K chars/mo | Yes (free tier) | No | 29+ built-in | stability, similarity_boost, style |
| Amazon Polly | 5M chars/mo (12 months) | Yes (free tier) | No | 60+ English, SSML | pitch, rate, volume, SSML |

## Architecture

### Provider Interface

```typescript
interface SpeechProvider {
  id: string
  name: string
  tier: "free" | "freeTier"
  requiresApiKey: boolean
  getVoices(): SpeechVoice[]
  synthesize(text: string, opts: SynthesisOptions): Promise<Blob | void>
  stop(): void
  testConnection?(apiKey: string, region?: string): Promise<boolean>
}
```

### Provider Registry

```typescript
const SpeechProviderRegistry = {
  register(provider: SpeechProvider): void
  get(id: string): SpeechProvider
  list(): SpeechProvider[]
  listByTier(tier: string): SpeechProvider[]
}
```

Matches upstream model provider pattern from `packages/opencode/src/provider/provider.ts`.

## UI Layout

```
┌─ Speech Settings ──────────────────────────────────┐
│                                                      │
│  Speech Provider: [Browser (Built-in, Offline)  v]  │
│   ├── No Setup Required                             │
│   │   └── Browser (Built-in, Offline)               │
│   └── Free Tier Available                           │
│       ├── Azure Speech (500K chars/mo free)          │
│       ├── Google Cloud TTS (4M chars/mo free)        │
│       ├── Amazon Polly (5M chars/mo free)            │
│       ├── ElevenLabs (10K chars/mo free)             │
│       └── OpenAI TTS ($5 free credit)                │
│                                                      │
│  > Provider Settings (per-provider config)           │
│  ── Global Settings (shared across providers) ──     │
│  > Voice Browser & Favorites                         │
│  > Voice Fine-Tuning (adapts per provider)           │
└──────────────────────────────────────────────────────┘
```

- Provider dropdown at top with grouped options
- Provider Settings section shows relevant config (API key, region, etc.)
- Global Settings shared: enable, auto-speak, volume, interrupt-on-type
- Voice Browser reuses same component, different data per provider
- Fine-Tuning adapts to provider capabilities

## File Structure

```
webview-ui/src/
├── data/
│   └── speech-providers.ts           # Registry + voice catalogs
├── types/
│   └── voice.ts                      # Interfaces (refactored)
├── utils/
│   ├── speech-providers/
│   │   ├── browser-provider.ts       # ~80 lines
│   │   ├── azure-provider.ts         # ~110 lines
│   │   ├── google-provider.ts        # ~100 lines
│   │   ├── openai-provider.ts        # ~70 lines
│   │   ├── elevenlabs-provider.ts    # ~90 lines
│   │   └── polly-provider.ts         # ~100 lines
│   ├── speech-playback.ts            # Shared playback + cache
│   └── speech-text-filter.ts         # 25-rule filter (unchanged)
└── components/settings/
    └── SpeechTab.tsx                 # Refactored for multi-provider

tests/unit/
├── speech-text-filter.test.ts
├── speech-provider-registry.test.ts
├── browser-provider.test.ts
└── azure-provider.test.ts
```

## CSP connect-src

```
https://*.tts.speech.microsoft.com    # Azure
https://texttospeech.googleapis.com   # Google
https://api.openai.com                # OpenAI
https://api.elevenlabs.io             # ElevenLabs
https://polly.*.amazonaws.com         # Amazon Polly
```

## VS Code Configuration Keys

```
kilo-code.new.speech.enabled
kilo-code.new.speech.provider           # "browser" | "azure" | "google" | ...
kilo-code.new.speech.autoSpeak
kilo-code.new.speech.volume
kilo-code.new.speech.interruptOnType
kilo-code.new.speech.interactionMode
kilo-code.new.speech.voiceId
kilo-code.new.speech.sentimentIntensity

# Per-provider credentials
kilo-code.new.speech.azure.apiKey
kilo-code.new.speech.azure.region
kilo-code.new.speech.google.apiKey
kilo-code.new.speech.openai.apiKey
kilo-code.new.speech.elevenlabs.apiKey
kilo-code.new.speech.polly.accessKeyId
kilo-code.new.speech.polly.secretAccessKey
kilo-code.new.speech.polly.region

# Tuning
kilo-code.new.speech.tuning.pitch
kilo-code.new.speech.tuning.rate
kilo-code.new.speech.tuning.style
kilo-code.new.speech.tuning.emphasis
kilo-code.new.speech.tuning.audioFormat
kilo-code.new.speech.tuning.pronunciations

# Favorites
kilo-code.new.speech.favorites.starred
kilo-code.new.speech.favorites.presets
```

## Message Protocol

Two new messages added to existing 4:

```
WebviewMessage:
  + "requestProviderVoices"    { providerId: string }

ExtensionMessage:
  + "providerVoicesLoaded"     { providerId: string, voices: SpeechVoice[] }
```

## Code Conventions (from AGENTS.md)

- No `let` — use `const`
- No `else` blocks — early returns
- No `any` type — proper generics
- Single-word identifiers: `cfg`, `pid`, `err`
- No mocks in tests — test real implementations
- `bun:test` framework
- Conventional commits: `feat(vscode): ...`
- PR description: 2-3 lines max

## Default Experience

1. User opens Settings > Speech
2. Provider defaults to "Browser (Built-in, Offline)"
3. Flips "Enable Speech" toggle
4. Works immediately — OS voices, no signup
5. Optionally switches to Azure/Google/etc for premium voices
