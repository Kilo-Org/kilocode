/** @jsxImportSource solid-js */
import type { Meta, StoryObj } from "storybook-solidjs-vite"
import { SessionReview } from "@opencode-ai/ui/session-review"
import { DiffComponentProvider } from "@opencode-ai/ui/context/diff"
import { Diff } from "@opencode-ai/ui/diff"

const meta: Meta = {
  title: "Components/SessionReview",
  decorators: [
    (Story) => (
      <DiffComponentProvider component={Diff}>
        <div style={{ width: "800px", "min-height": "300px" }}>
          <Story />
        </div>
      </DiffComponentProvider>
    ),
  ],
  parameters: { layout: "padded" },
}

export default meta
type Story = StoryObj

const beforeCounter = `import { createSignal } from "solid-js"

export function Counter() {
  const [count, setCount] = createSignal(0)

  return (
    <div>
      <p>Count: {count()}</p>
      <button onClick={() => setCount(count() + 1)}>
        Increment
      </button>
    </div>
  )
}
`

const afterCounter = `import { createSignal, createEffect } from "solid-js"

export function Counter(props: { initial?: number }) {
  const [count, setCount] = createSignal(props.initial ?? 0)

  createEffect(() => {
    document.title = \`Count: \${count()}\`
  })

  return (
    <div class="counter">
      <p>Count: {count()}</p>
      <button onClick={() => setCount(count() + 1)}>
        Increment
      </button>
      <button onClick={() => setCount(props.initial ?? 0)}>Reset</button>
    </div>
  )
}
`

const beforeConfig = `{
  "name": "my-app",
  "version": "1.0.0",
  "dependencies": {
    "solid-js": "^1.8.0"
  }
}
`

const afterConfig = `{
  "name": "my-app",
  "version": "1.1.0",
  "dependencies": {
    "solid-js": "^1.9.0",
    "@solidjs/router": "^0.14.0"
  },
  "devDependencies": {
    "typescript": "^5.0.0"
  }
}
`

const sampleDiffs = [
  {
    file: "src/counter.tsx",
    before: beforeCounter,
    after: afterCounter,
    additions: 6,
    deletions: 2,
    status: "modified" as const,
  },
  {
    file: "package.json",
    before: beforeConfig,
    after: afterConfig,
    additions: 5,
    deletions: 2,
    status: "modified" as const,
  },
  {
    file: "src/new-util.ts",
    before: "",
    after: `export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}
`,
    additions: 3,
    deletions: 0,
    status: "added" as const,
  },
]

export const Default: Story = {
  render: () => <SessionReview diffs={sampleDiffs} title={<span>Session Changes</span>} />,
}

export const SplitView: Story = {
  render: () => (
    <SessionReview diffs={sampleDiffs} diffStyle="split" title={<span>Session Changes (Split View)</span>} />
  ),
}

export const SingleFile: Story = {
  render: () => <SessionReview diffs={[sampleDiffs[0]]} title={<span>Single File Change</span>} />,
}

export const Empty: Story = {
  render: () => (
    <SessionReview
      diffs={[]}
      empty={
        <div style={{ padding: "24px", "text-align": "center", color: "var(--text-weak)" }}>
          No changes in this session.
        </div>
      }
    />
  ),
}
