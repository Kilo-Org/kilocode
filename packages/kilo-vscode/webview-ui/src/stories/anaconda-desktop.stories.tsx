/** @jsxImportSource solid-js */
/** Stories for Anaconda Desktop provider setup. */

import type { Meta, StoryObj } from "storybook-solidjs-vite"
import type { AnacondaDesktopStatus } from "@kilocode/sdk/v2/client"
import { useDialog } from "@kilocode/kilo-ui/context/dialog"
import { onMount } from "solid-js"
import { StoryProviders } from "./StoryProviders"
import AnacondaDesktopDialog from "../components/settings/AnacondaDesktopDialog"

const meta: Meta = {
  title: "Anaconda Desktop",
  parameters: { layout: "fullscreen" },
}
export default meta
type Story = StoryObj

function Dialog(props: { status: AnacondaDesktopStatus }) {
  const dialog = useDialog()
  onMount(() => dialog.show(() => <AnacondaDesktopDialog status={props.status} />))
  return null
}

export const NotInstalled: Story = {
  name: "Not installed",
  render: () => (
    <StoryProviders>
      <Dialog status={{ type: "not-installed", downloadURL: "about:blank" }} />
    </StoryProviders>
  ),
}

export const Waiting: Story = {
  name: "Waiting for server",
  render: () => (
    <StoryProviders>
      <Dialog status={{ type: "no-running-server", downloadedModels: 3 }} />
    </StoryProviders>
  ),
}

export const Ready: Story = {
  name: "Ready with tools",
  render: () => (
    <StoryProviders>
      <Dialog
        status={{
          type: "ready",
          serverID: "local-server",
          serverName: "Qwen Coder",
          models: [{ id: "qwen-coder", name: "Qwen 2.5 Coder 14B" }],
          context: 32768,
          toolcall: "supported",
        }}
      />
    </StoryProviders>
  ),
}

export const LimitedTools: Story = {
  name: "Ready without tools",
  render: () => (
    <StoryProviders>
      <Dialog
        status={{
          type: "ready",
          serverID: "local-server",
          serverName: "Llama Local",
          models: [{ id: "llama-local", name: "Llama 3.2 3B Instruct" }],
          context: 16384,
          toolcall: "unsupported",
        }}
      />
    </StoryProviders>
  ),
}
