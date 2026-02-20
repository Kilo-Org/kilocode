/** @jsxImportSource solid-js */
import type { Meta, StoryObj } from "storybook-solidjs-vite"
import { Diff } from "@opencode-ai/ui/diff-ssr"
import { WorkerPoolProvider } from "@opencode-ai/ui/context/worker-pool"

const meta: Meta = {
  title: "Components/DiffSSR",
  decorators: [
    (Story) => (
      <WorkerPoolProvider pools={{ unified: undefined, split: undefined }}>
        <div style={{ width: "700px", "min-height": "200px" }}>
          <Story />
        </div>
      </WorkerPoolProvider>
    ),
  ],
  parameters: { layout: "padded" },
}

export default meta
type Story = StoryObj

const beforeCode = `function add(a, b) {
  return a + b
}
`

const afterCode = `function add(a: number, b: number): number {
  return a + b
}

function subtract(a: number, b: number): number {
  return a - b
}
`

const mockPreloaded = {
  prerenderedHTML: "",
  oldFile: { name: "math.js", contents: beforeCode },
  newFile: { name: "math.ts", contents: afterCode },
}

export const Default: Story = {
  render: () => (
    <Diff
      before={{ name: "math.js", contents: beforeCode }}
      after={{ name: "math.ts", contents: afterCode }}
      preloadedDiff={mockPreloaded}
    />
  ),
}

export const WithSplitStyle: Story = {
  render: () => (
    <Diff
      before={{ name: "math.js", contents: beforeCode }}
      after={{ name: "math.ts", contents: afterCode }}
      diffStyle="split"
      preloadedDiff={mockPreloaded}
    />
  ),
}
