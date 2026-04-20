/** @jsxImportSource solid-js */
/**
 * Storybook stories for OnboardingWizard — DOM branch only (per CONVENTIONS.md §6).
 * Terminal branch coverage lives in onboarding-wizard-terminal test files.
 */
import { createSignal } from "solid-js"
import type { Meta, StoryObj } from "storybook-solidjs-vite"
import { OnboardingWizard, type QuickstartEntry } from "../primitives/onboarding-wizard"
import { RenderTargetProvider } from "../context/render-target"
import { createDomAdapter } from "../adapters/dom"

// ─── Shared fixtures ──────────────────────────────────────────────────────────

const SAMPLE_QUICKSTARTS: QuickstartEntry[] = [
  {
    id: "solo-enhanced",
    name: "Solo Enhanced",
    description: "A single senior developer with all capabilities",
    icon: "🧑‍💻",
  },
  {
    id: "code-review-pair",
    name: "Code Review Pair",
    description: "Developer + Reviewer for quality-focused workflows",
    icon: "🔍",
  },
  {
    id: "full-stack-team",
    name: "Full Stack Team",
    description: "Architect, frontend, backend, and reviewer roles",
    icon: "🏗️",
  },
  {
    id: "ci-cd-pipeline",
    name: "CI/CD Pipeline",
    description: "Build, test, and release automation team",
    icon: "🚀",
  },
  {
    id: "research-team",
    name: "Research Team",
    description: "Research, analysis, and documentation specialists",
    icon: "🔬",
  },
]

const SAMPLE_CONFIG = {
  enabled: true,
  roles: {
    architect: {
      displayName: "Architect",
      positionId: "architect",
      provider: "anthropic",
      model: "claude-sonnet-4-20250514",
      effort: "high",
      tier: 1,
      canDelegate: ["senior-dev", "developer"],
      maxConcurrent: 1,
      capabilities: ["planning", "design", "review", "release"],
      supplementaryCapabilities: [],
    },
    "senior-dev": {
      displayName: "Senior Developer",
      positionId: "senior-dev",
      provider: "anthropic",
      model: "claude-sonnet-4-20250514",
      effort: "medium",
      tier: 2,
      canDelegate: ["developer"],
      maxConcurrent: 3,
      capabilities: ["build", "review", "release"],
      supplementaryCapabilities: [],
    },
  },
  routing: {
    strategy: "hierarchical" as const,
    defaultRole: "architect" as const,
    escalationEnabled: true,
  },
}

// ─── Meta ─────────────────────────────────────────────────────────────────────

const meta: Meta<typeof OnboardingWizard> = {
  title: "Primitives/OnboardingWizard",
  component: OnboardingWizard,
  decorators: [
    (Story) => {
      const adapter = createDomAdapter()
      return (
        <RenderTargetProvider adapter={adapter}>
          <div style={{ "min-height": "500px", "background-color": "var(--color-background, #11111b)", padding: "20px" }}>
            <Story />
          </div>
        </RenderTargetProvider>
      )
    },
  ],
}

export default meta

type Story = StoryObj<typeof OnboardingWizard>

// ─── Stories ──────────────────────────────────────────────────────────────────

/**
 * Pick step — initial state showing all quickstart options.
 */
export const Pick: Story = {
  render: () => {
    const [open, setOpen] = createSignal(true)
    return (
      <OnboardingWizard
        open={open()}
        quickstarts={SAMPLE_QUICKSTARTS}
        onLoadQuickstart={async (id) => {
          await new Promise((r) => setTimeout(r, 300))
          return SAMPLE_CONFIG
        }}
        onReviewAccept={async () => {
          await new Promise((r) => setTimeout(r, 500))
        }}
        onCancel={() => setOpen(false)}
      />
    )
  },
}

/**
 * Review step — pre-populated with a valid config showing the RosterTable + StageCoverageIndicator.
 * The Start button should be enabled (validation passes).
 */
export const Review: Story = {
  render: () => {
    const [open, setOpen] = createSignal(true)
    // Jump directly to review step by simulating a quickstart that resolves immediately
    return (
      <OnboardingWizard
        open={open()}
        quickstarts={SAMPLE_QUICKSTARTS}
        onLoadQuickstart={async () => SAMPLE_CONFIG}
        onReviewAccept={async () => {
          await new Promise((r) => setTimeout(r, 800))
        }}
        onCancel={() => setOpen(false)}
      />
    )
  },
}

/**
 * ReviewInvalid — review step where the config fails validation.
 * The Start button should be disabled (grayed out).
 */
export const ReviewInvalid: Story = {
  render: () => {
    const [open, setOpen] = createSignal(true)
    const invalidConfig = {
      ...SAMPLE_CONFIG,
      roles: {
        architect: {
          ...SAMPLE_CONFIG.roles.architect,
          // Incomplete capabilities — will fail stage coverage validation
          capabilities: ["planning"],
        },
      },
    }
    return (
      <OnboardingWizard
        open={open()}
        quickstarts={SAMPLE_QUICKSTARTS}
        onLoadQuickstart={async () => invalidConfig}
        onReviewAccept={async () => {}}
        onCancel={() => setOpen(false)}
      />
    )
  },
}

/**
 * Done — wizard has completed successfully.
 */
export const Done: Story = {
  render: () => {
    const [open, setOpen] = createSignal(true)
    return (
      <OnboardingWizard
        open={open()}
        quickstarts={SAMPLE_QUICKSTARTS}
        onLoadQuickstart={async () => SAMPLE_CONFIG}
        onReviewAccept={async () => {
          // Completes immediately — takes wizard to "done" step
        }}
        onCancel={() => setOpen(false)}
      />
    )
  },
}
