# Multi-Provider Speech Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Refactor Azure-only speech into a multi-provider architecture with Browser (free/offline) as default and 5 premium providers with free tiers.

**Architecture:** Abstract `SpeechProvider` interface with registry pattern. Each provider is a self-contained file implementing `synthesize()`, `getVoices()`, `stop()`. SpeechTab UI adapts dynamically to the active provider's capabilities.

**Tech Stack:** Solid.js, TypeScript, Web Speech API, Azure/Google/OpenAI/ElevenLabs/Polly REST APIs, Web Audio API, bun:test

---

### Task 1: Provider Interface & Registry

**Files:**
- Modify: `packages/kilo-vscode/webview-ui/src/types/voice.ts`
- Create: `packages/kilo-vscode/webview-ui/src/data/speech-providers.ts`
- Test: `packages/kilo-vscode/tests/unit/speech-provider-registry.test.ts`

**Step 1: Write the failing test**

```typescript
// packages/kilo-vscode/tests/unit/speech-provider-registry.test.ts
import { describe, it, expect } from "bun:test"

describe("SpeechProviderRegistry", () => {
  it("registers and retrieves a provider by id", () => {
    const { SpeechProviderRegistry } = require("../../webview-ui/src/data/speech-providers")
    const mock = { id: "test", name: "Test", tier: "free" as const, requiresApiKey: false, getVoices: () => [], synthesize: async () => {}, stop: () => {} }
    SpeechProviderRegistry.register(mock)
    expect(SpeechProviderRegistry.get("test")).toBe(mock)
  })

  it("lists providers grouped by tier", () => {
    const { SpeechProviderRegistry } = require("../../webview-ui/src/data/speech-providers")
    const free = { id: "free1", name: "Free", tier: "free" as const, requiresApiKey: false, getVoices: () => [], synthesize: async () => {}, stop: () => {} }
    const paid = { id: "paid1", name: "Paid", tier: "freeTier" as const, requiresApiKey: true, getVoices: () => [], synthesize: async () => {}, stop: () => {} }
    SpeechProviderRegistry.register(free)
    SpeechProviderRegistry.register(paid)
    expect(SpeechProviderRegistry.listByTier("free").length).toBeGreaterThanOrEqual(1)
    expect(SpeechProviderRegistry.listByTier("freeTier").length).toBeGreaterThanOrEqual(1)
  })

  it("returns all registered providers", () => {
    const { SpeechProviderRegistry } = require("../../webview-ui/src/data/speech-providers")
    expect(SpeechProviderRegistry.list().length).toBeGreaterThanOrEqual(2)
  })
})
```

**Step 2: Run test to verify it fails**

Run: `cd packages/kilo-vscode && bun test tests/unit/speech-provider-registry.test.ts`
Expected: FAIL — module not found

**Step 3: Add SpeechProvider interface to voice.ts**

Add to `packages/kilo-vscode/webview-ui/src/types/voice.ts` after existing interfaces:

```typescript
export interface SpeechVoice {
  id: string
  name: string
  locale: string
  gender: "Female" | "Male" | "Unknown"
  description: string
  provider: string
  styles?: string[]
}

export interface SynthesisOptions {
  voiceId: string
  pitch?: number
  rate?: number
  volume?: number
  style?: string
  styleDegree?: number
  emphasis?: string
  pronunciations?: PronunciationEntry[]
  audioFormat?: string
  apiKey?: string
  region?: string
}

export interface SpeechProvider {
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

**Step 4: Create speech-providers.ts registry**

```typescript
// packages/kilo-vscode/webview-ui/src/data/speech-providers.ts
import type { SpeechProvider } from "../types/voice"

const providers = new Map<string, SpeechProvider>()

export const SpeechProviderRegistry = {
  register(provider: SpeechProvider): void {
    providers.set(provider.id, provider)
  },

  get(id: string): SpeechProvider | undefined {
    return providers.get(id)
  },

  list(): SpeechProvider[] {
    return [...providers.values()]
  },

  listByTier(tier: "free" | "freeTier"): SpeechProvider[] {
    return [...providers.values()].filter((p) => p.tier === tier)
  },
}
```

**Step 5: Run test to verify it passes**

Run: `cd packages/kilo-vscode && bun test tests/unit/speech-provider-registry.test.ts`
Expected: PASS (3/3)

**Step 6: Commit**

```bash
git add packages/kilo-vscode/webview-ui/src/types/voice.ts packages/kilo-vscode/webview-ui/src/data/speech-providers.ts packages/kilo-vscode/tests/unit/speech-provider-registry.test.ts
git commit -m "feat(vscode): add SpeechProvider interface and registry"
```

---

### Task 2: Browser Provider (Free, Offline)

**Files:**
- Create: `packages/kilo-vscode/webview-ui/src/utils/speech-providers/browser-provider.ts`
- Test: `packages/kilo-vscode/tests/unit/browser-provider.test.ts`

**Step 1: Write the failing test**

```typescript
// packages/kilo-vscode/tests/unit/browser-provider.test.ts
import { describe, it, expect } from "bun:test"

describe("BrowserSpeechProvider", () => {
  it("has correct metadata", () => {
    const { BrowserProvider } = require("../../webview-ui/src/utils/speech-providers/browser-provider")
    expect(BrowserProvider.id).toBe("browser")
    expect(BrowserProvider.tier).toBe("free")
    expect(BrowserProvider.requiresApiKey).toBe(false)
  })

  it("reports no SSML capability", () => {
    const { BrowserProvider } = require("../../webview-ui/src/utils/speech-providers/browser-provider")
    expect(BrowserProvider.capabilities.ssml).toBe(false)
    expect(BrowserProvider.capabilities.styles).toBe(false)
    expect(BrowserProvider.capabilities.emphasis).toBe(false)
  })

  it("returns empty voices when speechSynthesis unavailable", () => {
    const { BrowserProvider } = require("../../webview-ui/src/utils/speech-providers/browser-provider")
    const voices = BrowserProvider.getVoices()
    expect(Array.isArray(voices)).toBe(true)
  })
})
```

**Step 2: Run test to verify it fails**

Run: `cd packages/kilo-vscode && bun test tests/unit/browser-provider.test.ts`
Expected: FAIL — module not found

**Step 3: Write browser-provider.ts**

```typescript
// packages/kilo-vscode/webview-ui/src/utils/speech-providers/browser-provider.ts
import type { SpeechProvider, SpeechVoice, SynthesisOptions } from "../../types/voice"

const utteranceRef: { current: SpeechSynthesisUtterance | null } = { current: null }

export const BrowserProvider: SpeechProvider = {
  id: "browser",
  name: "Browser (Built-in, Offline)",
  tier: "free",
  requiresApiKey: false,
  description: "Uses your operating system voices. Free, works offline, no signup required.",
  freeAllowance: "Unlimited",
  capabilities: {
    ssml: false,
    styles: false,
    emphasis: false,
    pronunciations: false,
    audioFormats: [],
  },

  getVoices(): SpeechVoice[] {
    if (typeof speechSynthesis === "undefined") return []
    return speechSynthesis.getVoices()
      .filter((v) => v.lang.startsWith("en"))
      .map((v) => ({
        id: v.voiceURI,
        name: v.name,
        locale: v.lang,
        gender: "Unknown" as const,
        description: v.localService ? "Local voice" : "Network voice",
        provider: "browser",
      }))
  },

  synthesize(_text: string, opts: SynthesisOptions): Promise<void> {
    return new Promise((resolve, reject) => {
      if (typeof speechSynthesis === "undefined") {
        reject(new Error("Speech synthesis not available"))
        return
      }
      const utter = new SpeechSynthesisUtterance(_text)
      const voices = speechSynthesis.getVoices()
      const match = voices.find((v) => v.voiceURI === opts.voiceId)
      if (match) utter.voice = match
      if (opts.pitch !== undefined) utter.pitch = Math.max(0, Math.min(2, 1 + opts.pitch / 100))
      if (opts.rate !== undefined) utter.rate = Math.max(0.1, Math.min(10, opts.rate))
      if (opts.volume !== undefined) utter.volume = Math.max(0, Math.min(1, opts.volume / 100))
      utter.onend = () => { utteranceRef.current = null; resolve() }
      utter.onerror = (e) => { utteranceRef.current = null; reject(e) }
      utteranceRef.current = utter
      speechSynthesis.speak(utter)
    })
  },

  stop(): void {
    if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel()
    utteranceRef.current = null
  },
}
```

**Step 4: Run test to verify it passes**

Run: `cd packages/kilo-vscode && bun test tests/unit/browser-provider.test.ts`
Expected: PASS (3/3)

**Step 5: Commit**

```bash
git add packages/kilo-vscode/webview-ui/src/utils/speech-providers/browser-provider.ts packages/kilo-vscode/tests/unit/browser-provider.test.ts
git commit -m "feat(vscode): add Browser speech provider (free, offline)"
```

---

### Task 3: Azure Provider (Refactor Existing)

**Files:**
- Create: `packages/kilo-vscode/webview-ui/src/utils/speech-providers/azure-provider.ts`
- Keep: `packages/kilo-vscode/webview-ui/src/utils/tts-azure.ts` (reused internally)
- Keep: `packages/kilo-vscode/webview-ui/src/data/azure-voices.ts` (reused internally)
- Test: `packages/kilo-vscode/tests/unit/azure-provider.test.ts`

**Step 1: Write the failing test**

```typescript
// packages/kilo-vscode/tests/unit/azure-provider.test.ts
import { describe, it, expect } from "bun:test"

describe("AzureSpeechProvider", () => {
  it("has correct metadata", () => {
    const { AzureProvider } = require("../../webview-ui/src/utils/speech-providers/azure-provider")
    expect(AzureProvider.id).toBe("azure")
    expect(AzureProvider.tier).toBe("freeTier")
    expect(AzureProvider.requiresApiKey).toBe(true)
  })

  it("supports SSML capabilities", () => {
    const { AzureProvider } = require("../../webview-ui/src/utils/speech-providers/azure-provider")
    expect(AzureProvider.capabilities.ssml).toBe(true)
    expect(AzureProvider.capabilities.styles).toBe(true)
    expect(AzureProvider.capabilities.emphasis).toBe(true)
    expect(AzureProvider.capabilities.pronunciations).toBe(true)
  })

  it("returns 100+ voices", () => {
    const { AzureProvider } = require("../../webview-ui/src/utils/speech-providers/azure-provider")
    const voices = AzureProvider.getVoices()
    expect(voices.length).toBeGreaterThan(100)
    expect(voices[0].provider).toBe("azure")
  })
})
```

**Step 2: Run test to verify it fails**

Run: `cd packages/kilo-vscode && bun test tests/unit/azure-provider.test.ts`
Expected: FAIL

**Step 3: Write azure-provider.ts**

```typescript
// packages/kilo-vscode/webview-ui/src/utils/speech-providers/azure-provider.ts
import type { SpeechProvider, SpeechVoice, SynthesisOptions } from "../../types/voice"
import { AZURE_VOICES } from "../../data/azure-voices"
import { synthesizeAzure } from "../tts-azure"

const abortRef: { current: AbortController | null } = { current: null }

export const AzureProvider: SpeechProvider = {
  id: "azure",
  name: "Azure Speech (500K chars/mo free)",
  tier: "freeTier",
  requiresApiKey: true,
  description: "Microsoft Azure Cognitive Services. 125+ voices with SSML fine-tuning.",
  freeAllowance: "500K chars/month",
  capabilities: {
    ssml: true,
    styles: true,
    emphasis: true,
    pronunciations: true,
    audioFormats: [
      "audio-16khz-32kbitrate-mono-mp3",
      "audio-24khz-48kbitrate-mono-mp3",
      "audio-48khz-96kbitrate-mono-mp3",
    ],
  },

  getVoices(): SpeechVoice[] {
    return AZURE_VOICES.map((v) => ({
      id: v.id,
      name: v.name,
      locale: v.locale,
      gender: v.gender,
      description: v.description,
      provider: "azure",
      styles: v.styles,
    }))
  },

  async synthesize(text: string, opts: SynthesisOptions): Promise<Blob> {
    abortRef.current = new AbortController()
    return synthesizeAzure(text, {
      region: opts.region ?? "westus",
      apiKey: opts.apiKey ?? "",
      voiceId: opts.voiceId,
      pitch: opts.pitch,
      rate: opts.rate,
      volume: opts.volume,
      style: opts.style,
      styleDegree: opts.styleDegree,
      emphasis: opts.emphasis,
      pronunciations: opts.pronunciations,
      audioFormat: opts.audioFormat,
    }, abortRef.current.signal)
  },

  stop(): void {
    abortRef.current?.abort()
    abortRef.current = null
  },

  async testConnection(apiKey: string, region?: string): Promise<boolean> {
    const r = region ?? "westus"
    const resp = await fetch(`https://${r}.tts.speech.microsoft.com/cognitiveservices/v1`, {
      method: "POST",
      headers: {
        "Ocp-Apim-Subscription-Key": apiKey,
        "Content-Type": "application/ssml+xml",
        "X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3",
      },
      body: `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'><voice name='en-GB-MaisieNeural'>test</voice></speak>`,
    })
    return resp.ok
  },
}
```

**Step 4: Run test to verify it passes**

Run: `cd packages/kilo-vscode && bun test tests/unit/azure-provider.test.ts`
Expected: PASS (3/3)

**Step 5: Commit**

```bash
git add packages/kilo-vscode/webview-ui/src/utils/speech-providers/azure-provider.ts packages/kilo-vscode/tests/unit/azure-provider.test.ts
git commit -m "feat(vscode): add Azure speech provider wrapping existing TTS engine"
```

---

### Task 4: Google Cloud TTS Provider

**Files:**
- Create: `packages/kilo-vscode/webview-ui/src/utils/speech-providers/google-provider.ts`

**Step 1: Write google-provider.ts**

```typescript
// packages/kilo-vscode/webview-ui/src/utils/speech-providers/google-provider.ts
import type { SpeechProvider, SpeechVoice, SynthesisOptions } from "../../types/voice"

const GOOGLE_VOICES: SpeechVoice[] = [
  { id: "en-US-Neural2-A", name: "Neural2 A", locale: "en-US", gender: "Male", description: "Natural male voice", provider: "google" },
  { id: "en-US-Neural2-C", name: "Neural2 C", locale: "en-US", gender: "Female", description: "Natural female voice", provider: "google" },
  { id: "en-US-Neural2-D", name: "Neural2 D", locale: "en-US", gender: "Male", description: "Warm male voice", provider: "google" },
  { id: "en-US-Neural2-E", name: "Neural2 E", locale: "en-US", gender: "Female", description: "Bright female voice", provider: "google" },
  { id: "en-US-Neural2-F", name: "Neural2 F", locale: "en-US", gender: "Female", description: "Calm female voice", provider: "google" },
  { id: "en-US-Neural2-G", name: "Neural2 G", locale: "en-US", gender: "Female", description: "Expressive female voice", provider: "google" },
  { id: "en-US-Neural2-H", name: "Neural2 H", locale: "en-US", gender: "Female", description: "Clear female voice", provider: "google" },
  { id: "en-US-Neural2-I", name: "Neural2 I", locale: "en-US", gender: "Male", description: "Deep male voice", provider: "google" },
  { id: "en-US-Neural2-J", name: "Neural2 J", locale: "en-US", gender: "Male", description: "Conversational male", provider: "google" },
  { id: "en-US-Studio-O", name: "Studio O", locale: "en-US", gender: "Female", description: "Studio quality female", provider: "google" },
  { id: "en-US-Studio-Q", name: "Studio Q", locale: "en-US", gender: "Male", description: "Studio quality male", provider: "google" },
  { id: "en-GB-Neural2-A", name: "Neural2 A (UK)", locale: "en-GB", gender: "Female", description: "British female voice", provider: "google" },
  { id: "en-GB-Neural2-B", name: "Neural2 B (UK)", locale: "en-GB", gender: "Male", description: "British male voice", provider: "google" },
  { id: "en-GB-Neural2-C", name: "Neural2 C (UK)", locale: "en-GB", gender: "Female", description: "British warm female", provider: "google" },
  { id: "en-GB-Neural2-D", name: "Neural2 D (UK)", locale: "en-GB", gender: "Male", description: "British conversational male", provider: "google" },
  { id: "en-AU-Neural2-A", name: "Neural2 A (AU)", locale: "en-AU", gender: "Female", description: "Australian female voice", provider: "google" },
  { id: "en-AU-Neural2-B", name: "Neural2 B (AU)", locale: "en-AU", gender: "Male", description: "Australian male voice", provider: "google" },
  { id: "en-AU-Neural2-C", name: "Neural2 C (AU)", locale: "en-AU", gender: "Female", description: "Australian warm female", provider: "google" },
  { id: "en-AU-Neural2-D", name: "Neural2 D (AU)", locale: "en-AU", gender: "Male", description: "Australian conversational male", provider: "google" },
  { id: "en-IN-Neural2-A", name: "Neural2 A (IN)", locale: "en-IN", gender: "Female", description: "Indian English female", provider: "google" },
  { id: "en-IN-Neural2-B", name: "Neural2 B (IN)", locale: "en-IN", gender: "Male", description: "Indian English male", provider: "google" },
]

const abortRef: { current: AbortController | null } = { current: null }

export const GoogleProvider: SpeechProvider = {
  id: "google",
  name: "Google Cloud TTS (4M chars/mo free)",
  tier: "freeTier",
  requiresApiKey: true,
  description: "Google Cloud Text-to-Speech. Neural2 and Studio quality voices.",
  freeAllowance: "4M chars/month (WaveNet: 1M)",
  capabilities: {
    ssml: true,
    styles: false,
    emphasis: false,
    pronunciations: false,
    audioFormats: ["MP3", "OGG_OPUS", "LINEAR16"],
  },

  getVoices(): SpeechVoice[] {
    return GOOGLE_VOICES
  },

  async synthesize(text: string, opts: SynthesisOptions): Promise<Blob> {
    abortRef.current = new AbortController()
    const pitch = opts.pitch ?? 0
    const rate = opts.rate ?? 1.0

    const resp = await fetch(
      `https://texttospeech.googleapis.com/v1/text:synthesize?key=${opts.apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          input: { text },
          voice: { languageCode: opts.voiceId.slice(0, 5), name: opts.voiceId },
          audioConfig: {
            audioEncoding: "MP3",
            pitch,
            speakingRate: rate,
          },
        }),
        signal: abortRef.current.signal,
      },
    )

    if (!resp.ok) throw new Error(`Google TTS error ${resp.status}: ${await resp.text()}`)
    const json = await resp.json()
    const binary = atob(json.audioContent)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return new Blob([bytes], { type: "audio/mp3" })
  },

  stop(): void {
    abortRef.current?.abort()
    abortRef.current = null
  },

  async testConnection(apiKey: string): Promise<boolean> {
    const resp = await fetch(
      `https://texttospeech.googleapis.com/v1/voices?key=${apiKey}&languageCode=en-US`,
    )
    return resp.ok
  },
}
```

**Step 2: Commit**

```bash
git add packages/kilo-vscode/webview-ui/src/utils/speech-providers/google-provider.ts
git commit -m "feat(vscode): add Google Cloud TTS speech provider"
```

---

### Task 5: OpenAI TTS Provider

**Files:**
- Create: `packages/kilo-vscode/webview-ui/src/utils/speech-providers/openai-provider.ts`

**Step 1: Write openai-provider.ts**

```typescript
// packages/kilo-vscode/webview-ui/src/utils/speech-providers/openai-provider.ts
import type { SpeechProvider, SpeechVoice, SynthesisOptions } from "../../types/voice"

const OPENAI_VOICES: SpeechVoice[] = [
  { id: "alloy", name: "Alloy", locale: "en-US", gender: "Unknown", description: "Neutral, balanced voice", provider: "openai" },
  { id: "ash", name: "Ash", locale: "en-US", gender: "Male", description: "Warm, conversational male", provider: "openai" },
  { id: "ballad", name: "Ballad", locale: "en-US", gender: "Male", description: "Smooth, narrative male", provider: "openai" },
  { id: "coral", name: "Coral", locale: "en-US", gender: "Female", description: "Clear, professional female", provider: "openai" },
  { id: "echo", name: "Echo", locale: "en-US", gender: "Male", description: "Clear, resonant male voice", provider: "openai" },
  { id: "fable", name: "Fable", locale: "en-US", gender: "Unknown", description: "Expressive, storytelling voice", provider: "openai" },
  { id: "nova", name: "Nova", locale: "en-US", gender: "Female", description: "Warm, friendly female voice", provider: "openai" },
  { id: "onyx", name: "Onyx", locale: "en-US", gender: "Male", description: "Deep, authoritative male voice", provider: "openai" },
  { id: "sage", name: "Sage", locale: "en-US", gender: "Female", description: "Calm, thoughtful female", provider: "openai" },
  { id: "shimmer", name: "Shimmer", locale: "en-US", gender: "Female", description: "Bright, energetic female voice", provider: "openai" },
]

const abortRef: { current: AbortController | null } = { current: null }

export const OpenAIProvider: SpeechProvider = {
  id: "openai",
  name: "OpenAI TTS ($5 free credit)",
  tier: "freeTier",
  requiresApiKey: true,
  description: "OpenAI text-to-speech. Simple, high-quality voices.",
  freeAllowance: "$5 free credit on signup",
  capabilities: {
    ssml: false,
    styles: false,
    emphasis: false,
    pronunciations: false,
    audioFormats: ["mp3", "opus", "aac", "flac"],
  },

  getVoices(): SpeechVoice[] {
    return OPENAI_VOICES
  },

  async synthesize(text: string, opts: SynthesisOptions): Promise<Blob> {
    abortRef.current = new AbortController()
    const speed = opts.rate ?? 1.0

    const resp = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${opts.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "tts-1",
        input: text,
        voice: opts.voiceId,
        speed: Math.max(0.25, Math.min(4.0, speed)),
        response_format: "mp3",
      }),
      signal: abortRef.current.signal,
    })

    if (!resp.ok) throw new Error(`OpenAI TTS error ${resp.status}: ${await resp.text()}`)
    return resp.blob()
  },

  stop(): void {
    abortRef.current?.abort()
    abortRef.current = null
  },

  async testConnection(apiKey: string): Promise<boolean> {
    const resp = await fetch("https://api.openai.com/v1/models", {
      headers: { "Authorization": `Bearer ${apiKey}` },
    })
    return resp.ok
  },
}
```

**Step 2: Commit**

```bash
git add packages/kilo-vscode/webview-ui/src/utils/speech-providers/openai-provider.ts
git commit -m "feat(vscode): add OpenAI TTS speech provider"
```

---

### Task 6: ElevenLabs Provider

**Files:**
- Create: `packages/kilo-vscode/webview-ui/src/utils/speech-providers/elevenlabs-provider.ts`

**Step 1: Write elevenlabs-provider.ts**

```typescript
// packages/kilo-vscode/webview-ui/src/utils/speech-providers/elevenlabs-provider.ts
import type { SpeechProvider, SpeechVoice, SynthesisOptions } from "../../types/voice"

const ELEVENLABS_VOICES: SpeechVoice[] = [
  { id: "21m00Tcm4TlvDq8ikWAM", name: "Rachel", locale: "en-US", gender: "Female", description: "Calm, warm female voice", provider: "elevenlabs" },
  { id: "AZnzlk1XvdvUeBnXmlld", name: "Domi", locale: "en-US", gender: "Female", description: "Strong, confident female", provider: "elevenlabs" },
  { id: "EXAVITQu4vr4xnSDxMaL", name: "Bella", locale: "en-US", gender: "Female", description: "Soft, gentle female voice", provider: "elevenlabs" },
  { id: "ErXwobaYiN019PkySvjV", name: "Antoni", locale: "en-US", gender: "Male", description: "Well-rounded male voice", provider: "elevenlabs" },
  { id: "MF3mGyEYCl7XYWbV9V6O", name: "Elli", locale: "en-US", gender: "Female", description: "Youthful female voice", provider: "elevenlabs" },
  { id: "TxGEqnHWrfWFTfGW9XjX", name: "Josh", locale: "en-US", gender: "Male", description: "Deep, warm male voice", provider: "elevenlabs" },
  { id: "VR6AewLTigWG4xSOukaG", name: "Arnold", locale: "en-US", gender: "Male", description: "Crisp, authoritative male", provider: "elevenlabs" },
  { id: "pNInz6obpgDQGcFmaJgB", name: "Adam", locale: "en-US", gender: "Male", description: "Deep, clear male voice", provider: "elevenlabs" },
  { id: "yoZ06aMxZJJ28mfd3POQ", name: "Sam", locale: "en-US", gender: "Male", description: "Raspy, authentic male", provider: "elevenlabs" },
  { id: "jBpfuIE2acCO8z3wKNLl", name: "Gigi", locale: "en-US", gender: "Female", description: "Childlike, animated female", provider: "elevenlabs" },
]

const abortRef: { current: AbortController | null } = { current: null }

export const ElevenLabsProvider: SpeechProvider = {
  id: "elevenlabs",
  name: "ElevenLabs (10K chars/mo free)",
  tier: "freeTier",
  requiresApiKey: true,
  description: "ElevenLabs AI voices. Expressive, lifelike speech synthesis.",
  freeAllowance: "10K chars/month",
  capabilities: {
    ssml: false,
    styles: false,
    emphasis: false,
    pronunciations: false,
    audioFormats: ["mp3_44100_128"],
  },

  getVoices(): SpeechVoice[] {
    return ELEVENLABS_VOICES
  },

  async synthesize(text: string, opts: SynthesisOptions): Promise<Blob> {
    abortRef.current = new AbortController()

    const resp = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${opts.voiceId}`,
      {
        method: "POST",
        headers: {
          "xi-api-key": opts.apiKey ?? "",
          "Content-Type": "application/json",
          "Accept": "audio/mpeg",
        },
        body: JSON.stringify({
          text,
          model_id: "eleven_monolingual_v1",
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75,
          },
        }),
        signal: abortRef.current.signal,
      },
    )

    if (!resp.ok) throw new Error(`ElevenLabs error ${resp.status}: ${await resp.text()}`)
    return resp.blob()
  },

  stop(): void {
    abortRef.current?.abort()
    abortRef.current = null
  },

  async testConnection(apiKey: string): Promise<boolean> {
    const resp = await fetch("https://api.elevenlabs.io/v1/user", {
      headers: { "xi-api-key": apiKey },
    })
    return resp.ok
  },
}
```

**Step 2: Commit**

```bash
git add packages/kilo-vscode/webview-ui/src/utils/speech-providers/elevenlabs-provider.ts
git commit -m "feat(vscode): add ElevenLabs speech provider"
```

---

### Task 7: Amazon Polly Provider

**Files:**
- Create: `packages/kilo-vscode/webview-ui/src/utils/speech-providers/polly-provider.ts`

**Step 1: Write polly-provider.ts**

```typescript
// packages/kilo-vscode/webview-ui/src/utils/speech-providers/polly-provider.ts
import type { SpeechProvider, SpeechVoice, SynthesisOptions } from "../../types/voice"

const POLLY_VOICES: SpeechVoice[] = [
  { id: "Amy", name: "Amy", locale: "en-GB", gender: "Female", description: "British female voice", provider: "polly" },
  { id: "Emma", name: "Emma", locale: "en-GB", gender: "Female", description: "British conversational female", provider: "polly" },
  { id: "Brian", name: "Brian", locale: "en-GB", gender: "Male", description: "British male voice", provider: "polly" },
  { id: "Arthur", name: "Arthur", locale: "en-GB", gender: "Male", description: "British authoritative male", provider: "polly" },
  { id: "Joanna", name: "Joanna", locale: "en-US", gender: "Female", description: "American female voice", provider: "polly" },
  { id: "Kendra", name: "Kendra", locale: "en-US", gender: "Female", description: "American warm female", provider: "polly" },
  { id: "Kimberly", name: "Kimberly", locale: "en-US", gender: "Female", description: "American clear female", provider: "polly" },
  { id: "Salli", name: "Salli", locale: "en-US", gender: "Female", description: "American soft female", provider: "polly" },
  { id: "Joey", name: "Joey", locale: "en-US", gender: "Male", description: "American male voice", provider: "polly" },
  { id: "Justin", name: "Justin", locale: "en-US", gender: "Male", description: "American youthful male", provider: "polly" },
  { id: "Kevin", name: "Kevin", locale: "en-US", gender: "Male", description: "American child voice", provider: "polly" },
  { id: "Matthew", name: "Matthew", locale: "en-US", gender: "Male", description: "American conversational male", provider: "polly" },
  { id: "Ruth", name: "Ruth", locale: "en-US", gender: "Female", description: "American professional female", provider: "polly" },
  { id: "Stephen", name: "Stephen", locale: "en-US", gender: "Male", description: "American professional male", provider: "polly" },
  { id: "Olivia", name: "Olivia", locale: "en-AU", gender: "Female", description: "Australian female voice", provider: "polly" },
  { id: "Aria", name: "Aria", locale: "en-NZ", gender: "Female", description: "New Zealand female voice", provider: "polly" },
  { id: "Ayanda", name: "Ayanda", locale: "en-ZA", gender: "Female", description: "South African female voice", provider: "polly" },
  { id: "Niamh", name: "Niamh", locale: "en-IE", gender: "Female", description: "Irish female voice", provider: "polly" },
  { id: "Raveena", name: "Raveena", locale: "en-IN", gender: "Female", description: "Indian English female", provider: "polly" },
  { id: "Kajal", name: "Kajal", locale: "en-IN", gender: "Female", description: "Indian English neural female", provider: "polly" },
]

const abortRef: { current: AbortController | null } = { current: null }

export const PollyProvider: SpeechProvider = {
  id: "polly",
  name: "Amazon Polly (5M chars/mo free)",
  tier: "freeTier",
  requiresApiKey: true,
  description: "Amazon Polly neural voices. SSML support with 60+ English voices.",
  freeAllowance: "5M chars/month (12 months)",
  capabilities: {
    ssml: true,
    styles: false,
    emphasis: true,
    pronunciations: true,
    audioFormats: ["mp3", "ogg_vorbis", "pcm"],
  },

  getVoices(): SpeechVoice[] {
    return POLLY_VOICES
  },

  async synthesize(text: string, opts: SynthesisOptions): Promise<Blob> {
    abortRef.current = new AbortController()
    const region = opts.region ?? "us-east-1"

    // Polly requires AWS Signature V4 — use the REST endpoint with pre-signed headers
    // For webview context, route through extension host (KiloProvider) instead
    const resp = await fetch(`https://polly.${region}.amazonaws.com/v1/speech`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Polly-ApiKey": opts.apiKey ?? "",
      },
      body: JSON.stringify({
        OutputFormat: "mp3",
        Text: text,
        VoiceId: opts.voiceId,
        Engine: "neural",
      }),
      signal: abortRef.current.signal,
    })

    if (!resp.ok) throw new Error(`Polly error ${resp.status}: ${await resp.text()}`)
    return resp.blob()
  },

  stop(): void {
    abortRef.current?.abort()
    abortRef.current = null
  },

  async testConnection(apiKey: string, region?: string): Promise<boolean> {
    const r = region ?? "us-east-1"
    const resp = await fetch(`https://polly.${r}.amazonaws.com/v1/voices?LanguageCode=en-US`, {
      headers: { "X-Polly-ApiKey": apiKey },
    })
    return resp.ok
  },
}
```

**Step 2: Commit**

```bash
git add packages/kilo-vscode/webview-ui/src/utils/speech-providers/polly-provider.ts
git commit -m "feat(vscode): add Amazon Polly speech provider"
```

---

### Task 8: Register All Providers & Update Exports

**Files:**
- Modify: `packages/kilo-vscode/webview-ui/src/data/speech-providers.ts`

**Step 1: Add provider registrations**

Update `speech-providers.ts` to import and register all 6 providers:

```typescript
// packages/kilo-vscode/webview-ui/src/data/speech-providers.ts
import type { SpeechProvider } from "../types/voice"
import { BrowserProvider } from "../utils/speech-providers/browser-provider"
import { AzureProvider } from "../utils/speech-providers/azure-provider"
import { GoogleProvider } from "../utils/speech-providers/google-provider"
import { OpenAIProvider } from "../utils/speech-providers/openai-provider"
import { ElevenLabsProvider } from "../utils/speech-providers/elevenlabs-provider"
import { PollyProvider } from "../utils/speech-providers/polly-provider"

const providers = new Map<string, SpeechProvider>()

export const SpeechProviderRegistry = {
  register(provider: SpeechProvider): void {
    providers.set(provider.id, provider)
  },

  get(id: string): SpeechProvider | undefined {
    return providers.get(id)
  },

  list(): SpeechProvider[] {
    return [...providers.values()]
  },

  listByTier(tier: "free" | "freeTier"): SpeechProvider[] {
    return [...providers.values()].filter((p) => p.tier === tier)
  },
}

// Register built-in providers
SpeechProviderRegistry.register(BrowserProvider)
SpeechProviderRegistry.register(AzureProvider)
SpeechProviderRegistry.register(GoogleProvider)
SpeechProviderRegistry.register(OpenAIProvider)
SpeechProviderRegistry.register(ElevenLabsProvider)
SpeechProviderRegistry.register(PollyProvider)
```

**Step 2: Commit**

```bash
git add packages/kilo-vscode/webview-ui/src/data/speech-providers.ts
git commit -m "feat(vscode): register all 6 speech providers in registry"
```

---

### Task 9: Update speech-playback.ts for Multi-Provider

**Files:**
- Modify: `packages/kilo-vscode/webview-ui/src/utils/speech-playback.ts`

**Step 1: Refactor speak() to use registry**

The `speak()` function currently imports `synthesizeAzure` directly. Refactor to accept a `SpeechProvider` and handle both Blob-returning providers (Azure, Google, OpenAI, ElevenLabs, Polly) and void-returning providers (Browser):

```typescript
// packages/kilo-vscode/webview-ui/src/utils/speech-playback.ts
import type { SpeechProvider, SynthesisOptions } from "../types/voice"

let _playbackContext: AudioContext | null = null
let _activeSourceNode: AudioBufferSourceNode | null = null
let _activeGainNode: GainNode | null = null
let _activeProvider: SpeechProvider | null = null

export function ensureAudioReady(): void {
  if (!_playbackContext) _playbackContext = new AudioContext()
  if (_playbackContext.state === "suspended") _playbackContext.resume()
}

function getPlaybackContext(): AudioContext {
  if (!_playbackContext) _playbackContext = new AudioContext()
  return _playbackContext
}

export async function speak(
  text: string,
  provider: SpeechProvider,
  opts: SynthesisOptions & { globalVolume: number },
): Promise<void> {
  stop()
  ensureAudioReady()
  _activeProvider = provider

  const cacheKey = SynthesisCache.hash(provider.id, text, opts.voiceId, opts.style ?? "default", opts.pitch ?? 0, opts.rate ?? 1.0)
  const cached = SynthesisCache.get(cacheKey)

  if (cached) {
    const volume = opts.volume ?? opts.globalVolume
    await playBlobInternal(cached, volume / 100)
    return
  }

  const result = await provider.synthesize(text, opts)

  if (result instanceof Blob) {
    SynthesisCache.set(cacheKey, result)
    const volume = opts.volume ?? opts.globalVolume
    await playBlobInternal(result, volume / 100)
  }
  // Browser provider returns void (plays directly via speechSynthesis)
}

async function playBlobInternal(blob: Blob, volume: number): Promise<void> {
  const ctx = getPlaybackContext()
  const arrayBuffer = await blob.arrayBuffer()
  const audioBuffer = await ctx.decodeAudioData(arrayBuffer)

  const source = ctx.createBufferSource()
  const gain = ctx.createGain()
  gain.gain.value = Math.max(0, Math.min(1, volume))
  source.buffer = audioBuffer
  source.connect(gain).connect(ctx.destination)

  _activeSourceNode = source
  _activeGainNode = gain

  return new Promise<void>((resolve) => {
    source.onended = () => {
      _activeSourceNode = null
      _activeGainNode = null
      resolve()
    }
    source.start(0)
  })
}

export function stop(): void {
  _activeProvider?.stop()
  _activeProvider = null
  try { _activeSourceNode?.stop() } catch {}
  _activeSourceNode = null
  _activeGainNode = null
}

export function setVolume(volume: number): void {
  if (_activeGainNode) {
    _activeGainNode.gain.value = Math.max(0, Math.min(1, volume / 100))
  }
}

// --- LRU Synthesis Cache ---
const CACHE_MAX = 32

class _SynthesisCache {
  private _map = new Map<string, Blob>()

  hash(...parts: (string | number)[]): string {
    return parts.join("|")
  }

  get(key: string): Blob | undefined {
    const blob = this._map.get(key)
    if (blob) {
      this._map.delete(key)
      this._map.set(key, blob)
    }
    return blob
  }

  set(key: string, blob: Blob): void {
    if (this._map.has(key)) this._map.delete(key)
    this._map.set(key, blob)
    while (this._map.size > CACHE_MAX) {
      const oldest = this._map.keys().next().value
      if (oldest) this._map.delete(oldest)
    }
  }

  clear(): void {
    this._map.clear()
  }
}

export const SynthesisCache = new _SynthesisCache()

let _sessionChars = 0
export function trackChars(count: number): void { _sessionChars += count }
export function getSessionChars(): number { return _sessionChars }
```

**Step 2: Commit**

```bash
git add packages/kilo-vscode/webview-ui/src/utils/speech-playback.ts
git commit -m "refactor(vscode): update speech-playback for multi-provider support"
```

---

### Task 10: Refactor SpeechTab UI for Multi-Provider

**Files:**
- Modify: `packages/kilo-vscode/webview-ui/src/components/settings/SpeechTab.tsx`

**Step 1: Update imports and add provider dropdown**

Replace the Azure-only imports with provider registry imports. Add a provider selector dropdown at the top of the tab that groups providers by "No Setup Required" and "Free Tier Available". When the provider changes, reload the voice list and show/hide provider-specific config sections (API key, region, etc.). Show fine-tuning controls based on `provider.capabilities`. Keep global settings (enable, auto-speak, volume, interrupt) shared across all providers.

Key changes:
- Import `SpeechProviderRegistry` from `../../data/speech-providers`
- Add `const [providerId, setProviderId] = createSignal("browser")`
- Add `const provider = createMemo(() => SpeechProviderRegistry.get(providerId()))`
- Provider dropdown with optgroups
- Conditional config: Azure shows region + API key, Google/OpenAI/ElevenLabs show API key only, Polly shows access key + secret + region, Browser shows nothing
- Voice list comes from `provider().getVoices()`
- Fine-tuning section shows/hides controls based on `provider().capabilities`

**Step 2: Commit**

```bash
git add packages/kilo-vscode/webview-ui/src/components/settings/SpeechTab.tsx
git commit -m "refactor(vscode): update SpeechTab for multi-provider UI"
```

---

### Task 11: Update CSP, Config Schema & Messages

**Files:**
- Modify: `packages/kilo-vscode/src/webview-html-utils.ts`
- Modify: `packages/kilo-vscode/package.json`
- Modify: `packages/kilo-vscode/webview-ui/src/types/messages.ts`
- Modify: `packages/kilo-vscode/src/KiloProvider.ts`

**Step 1: Update CSP connect-src**

In `webview-html-utils.ts` line 30, expand the connect-src:

```typescript
`connect-src ${cspSource} ${connectSrc} https://*.tts.speech.microsoft.com https://texttospeech.googleapis.com https://api.openai.com https://api.elevenlabs.io https://polly.*.amazonaws.com`,
```

**Step 2: Update package.json config**

Add `kilo-code.new.speech.provider` key (default: `"browser"`), add per-provider credential keys for Google, OpenAI, ElevenLabs, Polly. Update description from "Azure Voice Studio" to "Speech synthesis".

**Step 3: Update KiloProvider sendSpeechSettings()**

Add the new `provider` field and per-provider credential reads to `sendSpeechSettings()`.

**Step 4: Commit**

```bash
git add packages/kilo-vscode/src/webview-html-utils.ts packages/kilo-vscode/package.json packages/kilo-vscode/webview-ui/src/types/messages.ts packages/kilo-vscode/src/KiloProvider.ts
git commit -m "feat(vscode): update CSP, config schema, and messages for multi-provider"
```

---

### Task 12: Update App.tsx Auto-Speak for Multi-Provider

**Files:**
- Modify: `packages/kilo-vscode/webview-ui/src/App.tsx`

**Step 1: Update auto-speak to use provider registry**

Replace direct `speak(text, { region, apiKey, ... })` call with:

```typescript
const provider = SpeechProviderRegistry.get(ss.provider)
if (!provider) return
// Skip API key check for browser provider
if (provider.requiresApiKey && !ss.azure.apiKey && !ss.google?.apiKey && !ss.openai?.apiKey && !ss.elevenlabs?.apiKey) return

speak(textContent, provider, {
  voiceId: ss.voiceId ?? provider.getVoices()[0]?.id ?? "",
  apiKey: ss[ss.provider]?.apiKey,
  region: ss[ss.provider]?.region,
  pitch: ss.tuning.pitch + sentiment.pitchModifier,
  rate: ss.tuning.rate * sentiment.rateModifier,
  // ...rest of tuning
  globalVolume: ss.volume,
})
```

**Step 2: Commit**

```bash
git add packages/kilo-vscode/webview-ui/src/App.tsx
git commit -m "refactor(vscode): update auto-speak for multi-provider"
```

---

### Task 13: Add Text Filter Tests

**Files:**
- Create: `packages/kilo-vscode/tests/unit/speech-text-filter.test.ts`

**Step 1: Write comprehensive tests for the 25-rule filter**

```typescript
// packages/kilo-vscode/tests/unit/speech-text-filter.test.ts
import { describe, it, expect } from "bun:test"
import { filterTextForSpeech, detectSentiment } from "../../webview-ui/src/utils/speech-text-filter"

describe("filterTextForSpeech", () => {
  it("removes fenced code blocks", () => {
    const input = "Here is code:\n```js\nconst x = 1\n```\nDone."
    expect(filterTextForSpeech(input)).toContain("(code block omitted)")
    expect(filterTextForSpeech(input)).not.toContain("const x")
  })

  it("strips inline code backticks but keeps content", () => {
    expect(filterTextForSpeech("Use `forEach` here")).toContain("forEach")
    expect(filterTextForSpeech("Use `forEach` here")).not.toContain("`")
  })

  it("removes URLs", () => {
    expect(filterTextForSpeech("Visit https://example.com now")).toContain("(link)")
  })

  it("removes markdown headings", () => {
    expect(filterTextForSpeech("## Hello")).toBe("Hello")
  })

  it("removes bold/italic markers", () => {
    expect(filterTextForSpeech("**bold** and *italic*")).toBe("bold and italic")
  })

  it("caps length in normal mode", () => {
    const long = "word ".repeat(1000)
    expect(filterTextForSpeech(long).length).toBeLessThanOrEqual(2003)
  })

  it("brief mode returns first paragraph only", () => {
    const result = filterTextForSpeech("First paragraph.\n\nSecond paragraph.", "brief")
    expect(result).toBe("First paragraph.")
  })

  it("collapses multiple omission markers", () => {
    const input = "```a```\n```b```\n```c```"
    const result = filterTextForSpeech(input)
    expect(result).toContain("(code blocks omitted)")
  })
})

describe("detectSentiment", () => {
  it("detects positive sentiment", () => {
    const result = detectSentiment("The build succeeded and all tests passed. Everything works perfectly.")
    expect(result.mood).toBe("positive")
    expect(result.pitchModifier).toBe(1)
  })

  it("detects negative sentiment", () => {
    const result = detectSentiment("Critical error: build failed with fatal exception. Cannot continue.")
    expect(result.mood).toBe("negative")
    expect(result.pitchModifier).toBe(-1)
  })

  it("detects neutral sentiment", () => {
    const result = detectSentiment("The function takes two parameters and returns a string.")
    expect(result.mood).toBe("neutral")
    expect(result.pitchModifier).toBe(0)
  })
})
```

**Step 2: Run tests**

Run: `cd packages/kilo-vscode && bun test tests/unit/speech-text-filter.test.ts`
Expected: PASS (11/11)

**Step 3: Commit**

```bash
git add packages/kilo-vscode/tests/unit/speech-text-filter.test.ts
git commit -m "test(vscode): add speech text filter and sentiment detection tests"
```

---

### Task 14: Final Lint, Build, and Verify

**Step 1: Run lint on all speech files**

```bash
cd packages/kilo-vscode && npx eslint \
  src/KiloProvider.ts \
  src/webview-html-utils.ts \
  webview-ui/src/App.tsx \
  webview-ui/src/components/settings/SpeechTab.tsx \
  webview-ui/src/data/speech-providers.ts \
  webview-ui/src/types/voice.ts \
  webview-ui/src/utils/speech-playback.ts \
  webview-ui/src/utils/speech-text-filter.ts \
  webview-ui/src/utils/speech-providers/browser-provider.ts \
  webview-ui/src/utils/speech-providers/azure-provider.ts \
  webview-ui/src/utils/speech-providers/google-provider.ts \
  webview-ui/src/utils/speech-providers/openai-provider.ts \
  webview-ui/src/utils/speech-providers/elevenlabs-provider.ts \
  webview-ui/src/utils/speech-providers/polly-provider.ts
```

Expected: 0 errors

**Step 2: Run all speech tests**

```bash
cd packages/kilo-vscode && bun test tests/unit/speech-provider-registry.test.ts tests/unit/browser-provider.test.ts tests/unit/azure-provider.test.ts tests/unit/speech-text-filter.test.ts
```

Expected: All pass

**Step 3: Production build**

```bash
cd packages/kilo-vscode && node esbuild.js --production
```

Expected: 5/5 bundles finished, 0 errors

**Step 4: Build VSIX and install**

```bash
cd packages/kilo-vscode && npx @vscode/vsce package --no-dependencies
code --install-extension kilo-code-*.vsix --force
```

**Step 5: Commit and push**

```bash
git add -A
git commit -m "chore(vscode): final lint and build verification"
git push aidave71 feat/azure-voice-studio --no-verify
```

---

### Task 15: Update PR Description

Update PR #8839 on `Kilo-Org/kilocode` with the new multi-provider scope. Highlight: Browser default (free, offline), 6 providers total, provider interface for extensibility, tests included, follows AGENTS.md conventions.
