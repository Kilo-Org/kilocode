/** @jsxImportSource solid-js */
import type { Meta, StoryObj } from "storybook-solidjs-vite"
import { RosterTable } from "../components/roster-table"
import type { RosterRole } from "../components/roster-table"
import { RenderTargetProvider } from "../context/render-target"
import { createDomAdapter } from "../adapters/dom"

// ─── Adapter ──────────────────────────────────────────────────────────────────

const adapter = createDomAdapter()

// ─── Meta ─────────────────────────────────────────────────────────────────────

const meta: Meta<typeof RosterTable> = {
  title: "Components/RosterTable",
  component: RosterTable,
  decorators: [
    (Story) => (
      <RenderTargetProvider adapter={adapter}>
        <Story />
      </RenderTargetProvider>
    ),
  ],
  parameters: { layout: "padded" },
}
export default meta
type Story = StoryObj<typeof RosterTable>

const noop = () => {}

// ─── Mock role data (inline — avoids @devilcode/cli resolution in Storybook) ──

const mockRoles: Record<string, RosterRole> = {
  architect: {
    displayName: "Architect",
    positionId: "architect",
    provider: "anthropic",
    model: "claude-opus-4-5",
    effort: "thorough",
    tier: 1,
    canDelegate: ["senior-dev"],
    maxConcurrent: 1,
    capabilities: ["planning", "design"],
    supplementaryCapabilities: [],
  },
  "senior-dev": {
    displayName: "Senior Developer",
    positionId: "senior-dev",
    provider: "anthropic",
    model: "claude-sonnet-4-5",
    effort: "default",
    tier: 2,
    canDelegate: [],
    maxConcurrent: 3,
    capabilities: ["implementation", "design"],
    supplementaryCapabilities: [],
  },
  reviewer: {
    displayName: "Reviewer",
    positionId: "reviewer",
    provider: "anthropic",
    model: "claude-haiku-4-5",
    effort: "low",
    tier: 2,
    canDelegate: [],
    maxConcurrent: 2,
    capabilities: ["review"],
    supplementaryCapabilities: [],
  },
}

// ─── Stories ──────────────────────────────────────────────────────────────────

export const Default: Story = {
  args: {
    roles: mockRoles,
    errorsByRole: {},
    onEdit: noop,
    onDelete: noop,
    onAdd: noop,
  },
}

export const WithErrors: Story = {
  args: {
    roles: mockRoles,
    errorsByRole: {
      architect: [
        { code: "custom", message: "Missing model", path: ["roles", "architect", "model"] },
        { code: "custom", message: "Provider required", path: ["roles", "architect", "provider"] },
      ],
    },
    onEdit: noop,
    onDelete: noop,
    onAdd: noop,
  },
}

export const Empty: Story = {
  args: {
    roles: {},
    errorsByRole: {},
    onEdit: noop,
    onDelete: noop,
    onAdd: noop,
  },
}

export const WithSelected: Story = {
  args: {
    roles: mockRoles,
    errorsByRole: {},
    selectedRole: "architect",
    onEdit: noop,
    onDelete: noop,
    onAdd: noop,
  },
}

export const FullTeam: Story = {
  args: {
    roles: {
      ...mockRoles,
      developer: {
        displayName: "Developer",
        positionId: "developer",
        provider: "openai",
        model: "gpt-4o",
        effort: "default",
        tier: 2,
        canDelegate: ["reviewer"],
        maxConcurrent: 4,
        capabilities: ["implementation"],
        supplementaryCapabilities: [],
      },
      "qa-tester": {
        displayName: "QA Tester",
        positionId: "qa-tester",
        provider: "anthropic",
        model: "claude-haiku-4-5",
        effort: "low",
        tier: 2,
        canDelegate: [],
        maxConcurrent: 2,
        capabilities: ["review", "testing"],
        supplementaryCapabilities: [],
      },
    },
    errorsByRole: {},
    onEdit: noop,
    onDelete: noop,
    onAdd: noop,
  },
}
