/** @jsxImportSource solid-js */
/**
 * Stories for ProfileView component.
 */

import type { Meta, StoryObj } from "storybook-solidjs-vite"
import { StoryProviders } from "./StoryProviders"
import ProfileView from "../components/profile/ProfileView"
import type { ProfileData, ProviderUsageData, DeviceAuthState } from "../types/messages"

const meta: Meta = {
  title: "Profile",
  parameters: { layout: "fullscreen" },
}
export default meta
type Story = StoryObj

const loggedInProfile: ProfileData = {
  profile: {
    email: "user@example.com",
    name: "Jane Developer",
    organizations: [
      { id: "org-1", name: "Acme Corp", role: "admin" },
      { id: "org-2", name: "Side Project Inc", role: "member" },
    ],
  },
  balance: { balance: 42.5 },
  kiloPass: null,
  currentOrgId: null,
}

const personalProfile: ProfileData = {
  profile: {
    email: "solo@example.com",
    name: "Solo Dev",
  },
  balance: { balance: 267.59 },
  kiloPass: {
    currentPeriodBaseCreditsUsd: 199,
    currentPeriodUsageUsd: 73.27,
    currentPeriodBonusCreditsUsd: 99.5,
    nextBillingAt: "2026-07-01T00:00:00.000Z",
  },
  currentOrgId: null,
}

const idleAuth: DeviceAuthState = { status: "idle" }

const usage: ProviderUsageData = {
  generatedAt: "2026-06-19T12:00:00.000Z",
  items: [
    {
      id: "kilo-managed:plan",
      providerID: "minimax",
      sourceKind: "kilo_managed",
      providerLabel: "MiniMax",
      planLabel: "Token Plan Plus",
      sourceLabel: "via Kilo",
      fetchState: "ready",
      planState: "active",
      routingState: "active",
      fetchedAt: "2026-06-19T12:00:00.000Z",
      managementUrl: "https://app.kilo.ai/subscriptions/coding-plans/plan",
      windows: [
        {
          id: "general-interval",
          resource: "general",
          period: { unit: "hour", value: 5 },
          unit: "percent",
          orientation: "remaining_percent",
          used: 24,
          remaining: 76,
          limit: 100,
          state: "active",
        },
      ],
    },
  ],
}

const directUsage: ProviderUsageData = {
  generatedAt: usage.generatedAt,
  items: [
    {
      ...usage.items[0],
      id: "minimax-direct-global",
      providerID: "minimax-coding-plan",
      sourceKind: "direct",
      sourceLabel: "MiniMax Global",
      routingState: "not_applicable",
      managementUrl: "https://platform.minimax.io/subscribe/token-plan",
    },
  ],
}

const noop = () => {}
const render = (profileData: ProfileData | null, providerUsage: ProviderUsageData, height: number, error?: string) => (
  <StoryProviders noPadding>
    <div style={{ width: "420px", height: `${height}px` }}>
      <ProfileView
        profileData={profileData}
        providerUsage={providerUsage}
        providerUsageError={error}
        deviceAuth={idleAuth}
        onLogin={noop}
      />
    </div>
  </StoryProviders>
)

export const LoggedIn: Story = {
  name: "ProfileView — logged in with orgs",
  render: () => render(loggedInProfile, usage, 900),
}

export const LoggedInPersonal: Story = {
  name: "ProfileView — personal account",
  render: () => render(personalProfile, usage, 900),
}

export const ScrollableUsage: Story = {
  name: "ProfileView — scrollable usage",
  render: () => render(personalProfile, usage, 480),
  play: (context: { canvasElement: HTMLElement }) => {
    const pane = context.canvasElement.querySelector<HTMLElement>("[data-profile-scroll]")
    if (pane) pane.scrollTop = pane.scrollHeight
  },
}

export const NotLoggedIn: Story = {
  name: "ProfileView — not logged in",
  render: () => render(null, directUsage, 620),
}

export const OrganizationContext: Story = {
  name: "ProfileView — organization context",
  render: () =>
    render({ ...loggedInProfile, currentOrgId: "org-1" }, { generatedAt: usage.generatedAt, items: [] }, 620),
}

export const StaleAndUnavailable: Story = {
  name: "ProfileView — stale and unavailable usage",
  render: () =>
    render(
      personalProfile,
      {
        generatedAt: usage.generatedAt,
        items: [
          {
            ...directUsage.items[0],
            fetchState: "stale",
            planState: "unknown",
            error: { code: "timeout", message: "The latest usage could not be loaded.", retryable: true },
          },
          {
            ...usage.items[0],
            id: "managed-unavailable",
            fetchState: "unavailable",
            windows: [],
            error: { code: "upstream", message: "Usage unavailable.", retryable: true },
          },
        ],
      },
      760,
      "Provider usage could not be refreshed.",
    ),
}

export const EmptyUsage: Story = {
  name: "ProfileView — no usage sources",
  render: () => render(personalProfile, { generatedAt: usage.generatedAt, items: [] }, 480),
}
