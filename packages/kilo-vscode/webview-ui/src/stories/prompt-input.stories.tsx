/** @jsxImportSource solid-js */
/**
 * Stories for the PromptInput component.
 *
 * Covers the main prompt bar including the mode switcher, model dropdown,
 * and the thinking-effort (variant) dropdown that appears for models that
 * support reasoning variants.
 *
 * Two viewport widths are captured for each scenario:
 *   - 420 px  — typical sidebar width
 *   - 200 px  — narrow / collapsed sidebar
 */

import type { Meta, StoryObj } from "storybook-solidjs-vite"
import { type ParentComponent } from "solid-js"
import { StoryProviders, mockSessionValue } from "./StoryProviders"
import { SessionContext } from "../context/session"
import { VSCodeProvider } from "../context/vscode"
import { ServerProvider } from "../context/server"
import { ConfigProvider } from "../context/config"
import { ProviderProvider } from "../context/provider"
import { PromptInput } from "../components/chat/PromptInput"

// ---------------------------------------------------------------------------
// Providers — wraps StoryProviders with the extra providers PromptInput needs
// (VSCode/Server/Config/ProviderProvider are not in StoryProviders because
//  composite stories only render display components that don't need them)
// ---------------------------------------------------------------------------

const agents = [
  { name: "code", description: "Write, edit and review code", mode: "primary" as const },
  { name: "ask", description: "Answer questions without making changes", mode: "primary" as const },
  { name: "architect", description: "Plan and design before implementation", mode: "primary" as const },
]

const PromptProviders: ParentComponent<{ variants?: boolean }> = (props) => {
  const base = mockSessionValue({ status: "idle" })
  const session = {
    ...base,
    agents: () => agents,
    selectedAgent: () => "code",
    variantList: () => (props.variants ? ["low", "medium", "high"] : []),
    currentVariant: () => (props.variants ? ("medium" as string | undefined) : undefined),
  }

  return (
    <VSCodeProvider>
      <ServerProvider>
        <ConfigProvider>
          <ProviderProvider>
            <StoryProviders noPadding>
              {/* overflow:hidden prevents margin-collapse so top/bottom borders are captured in screenshots */}
              <div style={{ overflow: "hidden" }}>
                <SessionContext.Provider value={session as any}>{props.children}</SessionContext.Provider>
              </div>
            </StoryProviders>
          </ProviderProvider>
        </ConfigProvider>
      </ServerProvider>
    </VSCodeProvider>
  )
}

// ---------------------------------------------------------------------------
// Meta — fullscreen so the screenshot is exactly the component width
// ---------------------------------------------------------------------------

const meta: Meta = {
  title: "Prompt Input",
  parameters: { layout: "fullscreen" },
}
export default meta
type Story = StoryObj

// ---------------------------------------------------------------------------
// Stories — standard model (no thinking variants)
// ---------------------------------------------------------------------------

export const Default420: Story = {
  name: "Default — 420px",
  render: () => (
    <PromptProviders>
      <PromptInput />
    </PromptProviders>
  ),
}

export const Default200: Story = {
  name: "Default — 200px",
  render: () => (
    <PromptProviders>
      <PromptInput />
    </PromptProviders>
  ),
}

// ---------------------------------------------------------------------------
// Stories — model with thinking-effort variants (ThinkingSelector visible)
// ---------------------------------------------------------------------------

export const WithThinking420: Story = {
  name: "With thinking selector — 420px",
  render: () => (
    <PromptProviders variants>
      <PromptInput />
    </PromptProviders>
  ),
}

export const WithThinking200: Story = {
  name: "With thinking selector — 200px",
  render: () => (
    <PromptProviders variants>
      <PromptInput />
    </PromptProviders>
  ),
}
