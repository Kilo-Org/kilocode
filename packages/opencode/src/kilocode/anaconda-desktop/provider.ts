import type { Hooks, Plugin } from "@kilocode/plugin"
import type { Model } from "@kilocode/sdk/v2"
import type { Provider } from "@opencode-ai/core/models-dev"
import { decodeMetadata, PROVIDER_ID, type Metadata, type Modality, type ModelDescriptor } from "./domain"

export const PLACEHOLDER_MODEL_ID = "setup-required"

export const CatalogProvider = {
  id: PROVIDER_ID,
  name: "Anaconda Desktop",
  description: "Run models served by Anaconda Desktop on this machine.",
  env: [],
  api: "",
  npm: "@ai-sdk/openai-compatible",
  models: {
    [PLACEHOLDER_MODEL_ID]: {
      id: PLACEHOLDER_MODEL_ID,
      name: "Set up Anaconda Desktop",
      family: PROVIDER_ID,
      release_date: "",
      attachment: false,
      reasoning: false,
      temperature: true,
      tool_call: false,
      cost: { input: 0, output: 0 },
      limit: { context: 0, output: 0 },
      modalities: { input: ["text"], output: ["text"] },
    },
  },
} satisfies Provider

export function overlay(providers: Record<string, Provider>): Record<string, Provider> {
  return { ...providers, [PROVIDER_ID]: CatalogProvider }
}

function model(input: ModelDescriptor, metadata: Metadata): Model {
  const includes = (items: ReadonlyArray<Modality>, value: Modality) => items.includes(value)
  return {
    id: input.id,
    providerID: PROVIDER_ID,
    api: {
      id: input.id,
      url: metadata.baseURL,
      npm: "@ai-sdk/openai-compatible",
    },
    name: input.name,
    ...(input.family ? { family: input.family } : {}),
    capabilities: {
      temperature: true,
      reasoning: false,
      attachment: input.input.some((item) => item !== "text"),
      toolcall: metadata.toolcall === "supported",
      input: {
        text: includes(input.input, "text"),
        audio: includes(input.input, "audio"),
        image: includes(input.input, "image"),
        video: includes(input.input, "video"),
        pdf: includes(input.input, "pdf"),
      },
      output: {
        text: includes(input.output, "text"),
        audio: includes(input.output, "audio"),
        image: includes(input.output, "image"),
        video: includes(input.output, "video"),
        pdf: includes(input.output, "pdf"),
      },
      interleaved: false,
    },
    cost: {
      input: 0,
      output: 0,
      cache: { read: 0, write: 0 },
    },
    limit: {
      context: metadata.context,
      output: 0,
    },
    status: "active",
    options: input.description ? { description: input.description } : {},
    headers: {},
    release_date: "",
    variants: {},
  }
}

export function hooks(): Hooks {
  return {
    auth: {
      provider: PROVIDER_ID,
      methods: [
        {
          type: "api",
          label: "Local Anaconda Desktop",
        },
      ],
      async loader(auth) {
        const stored = await auth()
        if (stored.type !== "api") return {}
        const metadata = decodeMetadata("metadata" in stored ? stored.metadata : undefined)
        if (!metadata) return {}
        return { baseURL: metadata.baseURL }
      },
    },
    provider: {
      id: PROVIDER_ID,
      async models(_provider, ctx) {
        if (ctx.auth?.type !== "api") return {}
        const metadata = decodeMetadata("metadata" in ctx.auth ? ctx.auth.metadata : undefined)
        if (!metadata) return {}
        return Object.fromEntries(metadata.models.map((item) => [item.id, model(item, metadata)]))
      },
    },
  }
}

export const AnacondaDesktopPlugin: Plugin = async () => hooks()
