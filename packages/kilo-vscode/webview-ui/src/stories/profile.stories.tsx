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
      id: "kilo-managed-minimax:plan",
      providerID: "minimax",
      sourceKind: "kilo_managed",
      providerLabel: "MiniMax",
      planLabel: "Token Plan Plus",
      sourceLabel: "via Kilo",
      fetchState: "ready",
      planState: "active",
      routingState: "missing",
      availabilityState: "available",
      fetchedAt: "2026-06-19T12:00:00.000Z",
      confidence: "high",
      source: "cloud",
      managementUrl: "https://app.kilo.ai/subscriptions/coding-plans/plan",
      windows: [
        {
          id: "general-interval",
          label: "Shared quota 5-hour",
          resource: "general",
          kind: "quota",
          unit: "percent",
          orientation: "remaining_percent",
          used: 24,
          remaining: 76,
          limit: 100,
          state: "active",
        },
      ],
      balances: [],
      credits: [],
    },
  ],
  kiloBilling: {
    topUpUrl: "https://app.kilo.ai/credits",
    manageUrl: "https://app.kilo.ai/subscriptions",
    autoTopUp: {
      enabled: true,
      amountCents: 5000,
      thresholdCents: 500,
      paymentType: "card",
      paymentBrand: "Visa",
      paymentLast4: "4242",
    },
  },
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
      source: "provider_api",
      managementUrl: "https://platform.minimax.io/subscribe/token-plan",
    },
  ],
}

const noop = () => {}

export const LoggedIn: Story = {
  name: "ProfileView — logged in with orgs",
  render: () => (
    <StoryProviders noPadding>
      <div style={{ width: "420px", height: "900px" }}>
        <ProfileView profileData={loggedInProfile} providerUsage={usage} deviceAuth={idleAuth} onLogin={noop} />
      </div>
    </StoryProviders>
  ),
}

export const LoggedInPersonal: Story = {
  name: "ProfileView — personal account",
  render: () => (
    <StoryProviders noPadding>
      <div style={{ width: "420px", height: "900px" }}>
        <ProfileView profileData={personalProfile} providerUsage={usage} deviceAuth={idleAuth} onLogin={noop} />
      </div>
    </StoryProviders>
  ),
}

export const NotLoggedIn: Story = {
  name: "ProfileView — not logged in",
  render: () => (
    <StoryProviders noPadding>
      <div style={{ width: "420px", height: "620px" }}>
        <ProfileView profileData={null} providerUsage={directUsage} deviceAuth={idleAuth} onLogin={noop} />
      </div>
    </StoryProviders>
  ),
}

export const OrganizationContext: Story = {
  name: "ProfileView — organization context",
  render: () => (
    <StoryProviders noPadding>
      <div style={{ width: "420px", height: "620px" }}>
        <ProfileView
          profileData={{ ...loggedInProfile, currentOrgId: "org-1" }}
          providerUsage={{ generatedAt: usage.generatedAt, items: [] }}
          deviceAuth={idleAuth}
          onLogin={noop}
        />
      </div>
    </StoryProviders>
  ),
}

export const StaleAndUnavailable: Story = {
  name: "ProfileView — stale and unavailable usage",
  render: () => (
    <StoryProviders noPadding>
      <div style={{ width: "420px", height: "760px" }}>
        <ProfileView
          profileData={personalProfile}
          providerUsage={{
            generatedAt: usage.generatedAt,
            items: [
              {
                ...directUsage.items[0],
                fetchState: "stale",
                error: { code: "timeout", message: "The latest usage could not be loaded.", retryable: true },
              },
              {
                ...usage.items[0],
                id: "managed-unavailable",
                fetchState: "unavailable",
                availabilityState: "unavailable",
                windows: [],
                error: { code: "upstream", message: "Usage unavailable.", retryable: true },
              },
            ],
          }}
          deviceAuth={idleAuth}
          onLogin={noop}
        />
      </div>
    </StoryProviders>
  ),
}

export const BalanceAndCredits: Story = {
  name: "ProfileView — balance and credits contract",
  render: () => (
    <StoryProviders noPadding>
      <div style={{ width: "420px", height: "620px" }}>
        <ProfileView
          profileData={null}
          providerUsage={{
            generatedAt: usage.generatedAt,
            items: [
              {
                ...directUsage.items[0],
                id: "future-balance",
                providerLabel: "Provider account",
                planLabel: "API balance",
                windows: [],
                balances: [
                  {
                    id: "usd",
                    label: "Available balance",
                    currency: "USD",
                    unit: "USD",
                    total: "12.50",
                    granted: "10.00",
                    toppedUp: "2.50",
                    available: true,
                  },
                ],
                credits: [{ id: "resets", label: "Reset credits", availableResets: 3 }],
              },
            ],
          }}
          deviceAuth={idleAuth}
          onLogin={noop}
        />
      </div>
    </StoryProviders>
  ),
}

export const EmptyUsage: Story = {
  name: "ProfileView — no usage sources",
  render: () => (
    <StoryProviders noPadding>
      <div style={{ width: "420px", height: "480px" }}>
        <ProfileView
          profileData={personalProfile}
          providerUsage={{ generatedAt: usage.generatedAt, items: [] }}
          deviceAuth={idleAuth}
          onLogin={noop}
        />
      </div>
    </StoryProviders>
  ),
}
