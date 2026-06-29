/** @jsxImportSource solid-js */
/**
 * Stories for shared controls: ModelSelector.
 */

import { createSignal } from "solid-js"
import type { Meta, StoryObj } from "storybook-solidjs-vite"
import { StoryProviders, mockSessionValue } from "./StoryProviders"
import { ModelSelectorBase } from "../components/shared/ModelSelector"
import { SessionContext } from "../context/session"
import type { EnrichedModel } from "../context/provider"
import type { ModelSelection } from "../types/messages"

const meta: Meta = {
  title: "Shared",
  parameters: { layout: "fullscreen" },
}
export default meta
type Story = StoryObj

// ---------------------------------------------------------------------------
// ModelSelector
// ---------------------------------------------------------------------------

export const ModelSelectorNoProviders: Story = {
  name: "ModelSelector — no providers",
  render: () => (
    <StoryProviders>
      <div style={{ display: "flex", "align-items": "center", gap: "8px" }}>
        <ModelSelectorBase
          value={{ providerID: "kilo", modelID: "kilo-auto/frontier" }}
          onSelect={() => {}}
          placement="bottom-start"
        />
      </div>
    </StoryProviders>
  ),
}

const ACCESSIBLE_MODELS: EnrichedModel[] = [
  {
    id: "kilo-auto/efficient",
    name: "Kilo Auto Efficient",
    providerID: "kilo",
    providerName: "Kilo",
    recommendedIndex: 0,
    options: {
      description:
        "Routes each request to the cheapest model that gets the job done, based on continuously benchmarked accuracy and cost.",
    },
    autoRouting: { models: ["google/gemini-2.5-flash", "anthropic/claude-sonnet-4.6"] },
  },
  { id: "omega", name: "Omega", providerID: "openai", providerName: "OpenAI", recommendedIndex: 1 },
  { id: "alpha", name: "Alpha", providerID: "kilo", providerName: "Kilo" },
  { id: "bravo", name: "Bravo", providerID: "kilo", providerName: "Kilo" },
  { id: "charlie", name: "Charlie", providerID: "kilo", providerName: "Kilo" },
  { id: "delta", name: "Delta", providerID: "kilo", providerName: "Kilo" },
  { id: "echo", name: "Echo", providerID: "kilo", providerName: "Kilo" },
  { id: "nova", name: "Nova", providerID: "nvidia", providerName: "NVIDIA" },
  { id: "nemotron", name: "Nemotron", providerID: "nvidia", providerName: "NVIDIA" },
]

const AccessibleModelSelector = () => {
  const [value, setValue] = createSignal<ModelSelection | null>({ providerID: "kilo", modelID: "alpha" })

  return (
    <div style={{ display: "flex", "align-items": "center", gap: "12px" }}>
      <ModelSelectorBase
        value={value()}
        models={ACCESSIBLE_MODELS}
        label="Review model"
        description="Choose the model used for code review tasks."
        allowClear
        clearLabel="Use default model"
        placement="bottom-start"
        onSelect={(providerID, modelID) => {
          setValue(providerID && modelID ? { providerID, modelID } : null)
        }}
      />
      <output data-testid="model-selector-value">{value()?.modelID ?? "default"}</output>
    </div>
  )
}

export const ModelSelectorAccessible: Story = {
  name: "ModelSelector — accessible interaction",
  render: () => (
    <StoryProviders>
      <AccessibleModelSelector />
    </StoryProviders>
  ),
}

export const ModelSelectorSelectedFavorite: Story = {
  name: "ModelSelector — selected favorite",
  render: () => {
    const session = {
      ...mockSessionValue(),
      favoriteModels: () => [{ providerID: "kilo", modelID: "alpha" }],
    }

    return (
      <StoryProviders>
        <SessionContext.Provider value={session as any}>
          <AccessibleModelSelector />
        </SessionContext.Provider>
      </StoryProviders>
    )
  },
}

const LARGE_MODELS: EnrichedModel[] = Array.from({ length: 600 }, (_, i) => {
  const id = String(i).padStart(3, "0")
  const provider = `provider-${i % 12}`
  return {
    id: `model-${id}`,
    name: `Model ${id}`,
    providerID: provider,
    providerName: `Provider ${i % 12}`,
  }
})

export const ModelSelectorLargeCatalog: Story = {
  name: "ModelSelector — large catalog",
  render: () => (
    <StoryProviders>
      <ModelSelectorBase
        value={{ providerID: "provider-0", modelID: "model-300" }}
        models={LARGE_MODELS}
        placement="bottom-start"
        onSelect={() => {}}
      />
    </StoryProviders>
  ),
}
