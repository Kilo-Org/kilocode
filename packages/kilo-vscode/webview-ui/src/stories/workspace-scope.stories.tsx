/** @jsxImportSource solid-js */
import { onMount } from "solid-js"
import type { Meta, StoryObj } from "storybook-solidjs-vite"
import { StoryProviders } from "./StoryProviders"
import { SidebarEmptyState } from "../components/chat/SidebarEmptyState"
import { WorkStyleContext } from "../context/work-style"
import type { WorkspaceScopeMessage } from "../types/messages"

const meta: Meta = {
  title: "Chat/Workspace scope",
  parameters: { layout: "fullscreen" },
}
export default meta
type Story = StoryObj

function EmptyState(props: { folder?: WorkspaceScopeMessage["folder"]; onboarding?: boolean }) {
  onMount(() => window.postMessage({ type: "workspaceScope", folder: props.folder }, window.origin))
  return (
    <StoryProviders noPadding>
      <WorkStyleContext.Provider
        value={{
          style: () => "unset",
          loading: () => false,
          applying: () => false,
          shouldShowOnboarding: () => props.onboarding ?? false,
          apply: () => {},
        }}
      >
        <div style={{ height: "700px", overflow: "auto" }}>
          <SidebarEmptyState />
        </div>
      </WorkStyleContext.Provider>
    </StoryProviders>
  )
}

const folder = { name: "frontend", path: "/workspace/frontend" }

export const SingleFolder: Story = {
  render: () => <EmptyState />,
}

export const MultipleFolders: Story = {
  render: () => <EmptyState folder={folder} />,
}

export const Onboarding: Story = {
  render: () => <EmptyState folder={folder} onboarding />,
}

export const NarrowLongName: Story = {
  render: () => (
    <div style={{ width: "200px" }}>
      <EmptyState folder={{ name: "very-long-workspace-folder-name-without-spaces", path: "/workspace/long-name" }} />
    </div>
  ),
}
