/** @jsxImportSource solid-js */
/**
 * Stories for ProfileView component.
 */

import type { Meta, StoryObj } from "storybook-solidjs-vite"
import { StoryProviders } from "./StoryProviders"
import ProfileView from "../components/profile/ProfileView"
import type { ProfileData, DeviceAuthState } from "../types/messages"

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
  currentOrgId: null,
}

const personalProfile: ProfileData = {
  profile: {
    email: "solo@example.com",
    name: "Solo Dev",
  },
  balance: { balance: 7.25 },
  currentOrgId: null,
}

const idleAuth: DeviceAuthState = { status: "idle" }

const noop = () => {}

export const LoggedIn: Story = {
  name: "ProfileView — logged in with orgs",
  render: () => (
    <StoryProviders noPadding>
      <div style={{ width: "420px", height: "500px" }}>
        <ProfileView profileData={loggedInProfile} deviceAuth={idleAuth} onLogin={noop} />
      </div>
    </StoryProviders>
  ),
}

export const LoggedInPersonal: Story = {
  name: "ProfileView — personal account",
  render: () => (
    <StoryProviders noPadding>
      <div style={{ width: "420px", height: "400px" }}>
        <ProfileView profileData={personalProfile} deviceAuth={idleAuth} onLogin={noop} />
      </div>
    </StoryProviders>
  ),
}

export const NotLoggedIn: Story = {
  name: "ProfileView — not logged in",
  render: () => (
    <StoryProviders noPadding>
      <div style={{ width: "420px", height: "300px" }}>
        <ProfileView profileData={null} deviceAuth={idleAuth} onLogin={noop} />
      </div>
    </StoryProviders>
  ),
}
