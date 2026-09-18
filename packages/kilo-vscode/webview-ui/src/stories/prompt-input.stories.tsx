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
import { PromptInput } from "../components/chat/PromptInput"
import { SandboxTooltipContent } from "../components/shared/SandboxButton"
import { contextDrafts } from "../utils/draft-store"
import { Button } from "@kilocode/kilo-ui/button"
import { Icon } from "@kilocode/kilo-ui/icon"
import { Tooltip } from "@kilocode/kilo-ui/tooltip"

const agents = [
  { name: "code", description: "Write, edit and review code", mode: "primary" as const },
  { name: "ask", description: "Answer questions without making changes", mode: "primary" as const },
  { name: "architect", description: "Plan and design before implementation", mode: "primary" as const },
]

const PromptProviders: ParentComponent<{ variants?: boolean; training?: boolean }> = (props) => {
  const base = mockSessionValue({ status: "idle" })
  const session = {
    ...base,
    agents: () => agents,
    selectedAgent: () => "code",
    variantList: () => (props.variants ? ["low", "medium", "high"] : []),
    currentVariant: () => (props.variants ? ("medium" as string | undefined) : undefined),
  }

  return (
    <StoryProviders noPadding training={props.training}>
      {/* overflow:hidden prevents margin-collapse so top/bottom borders are captured in screenshots */}
      <div style={{ overflow: "hidden" }}>
        <SessionContext.Provider value={session as any}>{props.children}</SessionContext.Provider>
      </div>
    </StoryProviders>
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
// Stories — model whose prompts may be used for training
// ---------------------------------------------------------------------------

export const WithPromptTraining420: Story = {
  name: "With prompt training indicator — 420px",
  render: () => (
    <PromptProviders training>
      <PromptInput />
    </PromptProviders>
  ),
}

export const WithPromptTraining200: Story = {
  name: "With prompt training indicator — 200px",
  render: () => (
    <PromptProviders training>
      <PromptInput />
    </PromptProviders>
  ),
}

export const SandboxTooltipEnabled: Story = {
  name: "Sandbox tooltip — enabled",
  render: () => (
    <StoryProviders>
      <div style={{ padding: "120px 0 0 180px" }}>
        <Tooltip
          forceOpen
          value={<SandboxTooltipContent enabled network />}
          contentClass="prompt-sandbox-tooltip-content"
          placement="top"
        >
          <Button variant="ghost" size="small" class="prompt-status-button prompt-status-button--active">
            <Icon name="lock" size="small" />
          </Button>
        </Tooltip>
      </div>
    </StoryProviders>
  ),
}

export const SandboxTooltipDisabled: Story = {
  name: "Sandbox tooltip — disabled",
  render: () => (
    <StoryProviders>
      <div style={{ padding: "120px 0 0 180px" }}>
        <Tooltip
          forceOpen
          value={<SandboxTooltipContent enabled={false} network />}
          contentClass="prompt-sandbox-tooltip-content"
          placement="top"
        >
          <Button variant="ghost" size="small" class="prompt-status-button">
            <Icon name="lock" size="small" />
          </Button>
        </Tooltip>
      </div>
    </StoryProviders>
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

// ---------------------------------------------------------------------------
// Stories — code context pills (added from the editor "Add as context" command)
// ---------------------------------------------------------------------------

const CODE_CONTEXT_BOX = "story-code-context"
const codeContexts = [
  {
    id: "context-1",
    filePath: "tests/unit/services/test_subchannel_sharing.py",
    startLine: 271,
    endLine: 277,
    text: 'writer_count.return_value = 2\nwith pytest.raises(Forbidden, match="Unpaid organizations can only have 2 collaborators"):',
  },
  {
    id: "context-2",
    filePath: "packages/kilo-vscode/webview-ui/src/components/chat/PromptInput.tsx",
    startLine: 12,
    endLine: 18,
    text: "export const PromptInput: Component<PromptInputProps> = (props) => {",
  },
]

const manyContexts = Array.from({ length: 8 }, (_, index) => ({
  id: `many-${index}`,
  filePath: `packages/kilo-vscode/src/services/code-actions/file-${index}.ts`,
  startLine: index * 10 + 1,
  endLine: index * 10 + 12,
  text: `export function action${index}() {\n  return ${index}\n}`,
}))

const largeContext = {
  id: "large-1",
  filePath: "packages/opencode/src/session/session.ts",
  startLine: 1,
  endLine: 400,
  text: Array.from({ length: 400 }, (_, index) => `const line${index + 1} = ${index + 1}`).join("\n"),
}

function CodeContextPrompt(props: { box: string; contexts: typeof codeContexts }) {
  contextDrafts.set(`${props.box}:session:story-session-001`, props.contexts)
  return (
    <PromptProviders>
      <PromptInput boxId={props.box} />
    </PromptProviders>
  )
}

export const WithCodeContext420: Story = {
  name: "With code context pills — 420px",
  render: () => <CodeContextPrompt box={CODE_CONTEXT_BOX} contexts={codeContexts} />,
}

export const WithCodeContext200: Story = {
  name: "With code context pills — 200px",
  render: () => <CodeContextPrompt box={CODE_CONTEXT_BOX} contexts={codeContexts} />,
}

export const WithManyCodeContexts420: Story = {
  name: "With many code contexts — 420px",
  render: () => <CodeContextPrompt box="story-code-context-many" contexts={manyContexts} />,
}

export const WithLargeCodeContext420: Story = {
  name: "With large code context — 420px",
  render: () => <CodeContextPrompt box="story-code-context-large" contexts={[largeContext]} />,
}
