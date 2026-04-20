/** @jsxImportSource solid-js */
import type { Meta, StoryObj } from "storybook-solidjs-vite"
import { TabGroup } from "../primitives/tab-group"
import { RenderTargetProvider } from "../context/render-target"
import { createDomAdapter } from "../adapters/dom"
import { createSignal } from "solid-js"

const meta: Meta = {
  title: "Primitives/TabGroup",
  decorators: [
    (Story) => (
      <RenderTargetProvider adapter={createDomAdapter()}>
        <Story />
      </RenderTargetProvider>
    ),
  ],
}

export default meta

const TABS = [
  { id: "overview", label: "Overview", closeable: false },
  { id: "files", label: "Files", closeable: true },
  { id: "output", label: "Output", closeable: true },
]

export const Default = {
  render: () => {
    const [active, setActive] = createSignal("overview")
    return (
      <div style={{ width: "600px", height: "300px" }}>
        <TabGroup
          tabs={TABS}
          activeTab={active()}
          onSwitch={setActive}
          onClose={(id) => console.log("close", id)}
        >
          {(tab) => (
            <div style={{ padding: "16px" }}>
              <p>Content for: {tab.label}</p>
              <p>Tab ID: {tab.id}</p>
            </div>
          )}
        </TabGroup>
      </div>
    )
  },
}

export const CompactDensity = {
  render: () => {
    const [active, setActive] = createSignal("files")
    return (
      <div style={{ width: "600px", height: "300px" }}>
        <TabGroup
          tabs={TABS}
          activeTab={active()}
          onSwitch={setActive}
          density="compact"
        >
          {(tab) => (
            <div style={{ padding: "8px" }}>
              <p>Compact: {tab.label}</p>
            </div>
          )}
        </TabGroup>
      </div>
    )
  },
}

export const SingleTab = {
  render: () => {
    const [active, setActive] = createSignal("overview")
    return (
      <div style={{ width: "400px", height: "200px" }}>
        <TabGroup
          tabs={[{ id: "overview", label: "Overview", closeable: false }]}
          activeTab={active()}
          onSwitch={setActive}
        >
          {(tab) => <div style={{ padding: "12px" }}>Single tab: {tab.label}</div>}
        </TabGroup>
      </div>
    )
  },
}
