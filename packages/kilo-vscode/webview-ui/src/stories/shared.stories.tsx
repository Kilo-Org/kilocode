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
  { id: "alpha", name: "Alpha", providerID: "kilo", providerName: "Kilo" },
  { id: "bravo", name: "Bravo", providerID: "kilo", providerName: "Kilo" },
  { id: "charlie", name: "Charlie", providerID: "kilo", providerName: "Kilo" },
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
