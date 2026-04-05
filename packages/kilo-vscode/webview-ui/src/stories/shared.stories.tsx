/** @jsxImportSource solid-js */
/**
 * Stories for shared controls: ModelSelector.
 */

import type { Meta, StoryObj } from "storybook-solidjs-vite"
import { StoryProviders } from "./StoryProviders"
import { ModelSelectorBase } from "../components/shared/ModelSelector"

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
