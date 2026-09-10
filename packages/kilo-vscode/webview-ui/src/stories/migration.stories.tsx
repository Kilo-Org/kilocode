/** @jsxImportSource solid-js */
/**
 * Stories for migration flows.
 */

import type { Meta, StoryObj } from "storybook-solidjs-vite"
import { onMount, type Component } from "solid-js"
import MigrationWizard from "../components/migration/MigrationWizard"
import { StoryProviders } from "./StoryProviders"

const meta: Meta = {
  title: "Migration",
  parameters: { layout: "fullscreen" },
}
export default meta
type Story = StoryObj

const operationId = "roo-migration-story"

const RooWizard: Component = () => {
  onMount(() => {
    queueMicrotask(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            type: "migrationData",
            source: "roo",
            operationId,
            data: {
              providers: [],
              mcpServers: [],
              customModes: [],
              sessions: [
                {
                  id: "roo-1",
                  title: "Refactor authentication flow",
                  directory: "/workspace/app",
                  time: 1760443200000,
                },
                { id: "roo-2", title: "Add billing dashboard", directory: "/workspace/app", time: 1760356800000 },
                { id: "roo-3", title: "Investigate flaky tests", directory: "/workspace/app", time: 1760270400000 },
              ],
            },
          },
        }),
      )
    })
  })

  return <MigrationWizard source="roo" operationId={operationId} onBack={() => {}} onComplete={() => {}} />
}

export const RooWizardSelecting: Story = {
  name: "Roo wizard — selecting sessions",
  render: () => (
    <StoryProviders>
      <div style={{ "max-height": "720px", overflow: "auto" }}>
        <RooWizard />
      </div>
    </StoryProviders>
  ),
}
