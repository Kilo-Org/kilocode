/** @jsxImportSource solid-js */
import type { Meta, StoryObj } from "storybook-solidjs-vite"
import { Diff } from "@opencode-ai/ui/diff"

const meta: Meta = {
  title: "Components/Diff",
  decorators: [
    (Story) => (
      <div style={{ width: "700px", "min-height": "200px" }}>
        <Story />
      </div>
    ),
  ],
  parameters: { layout: "padded" },
}

export default meta
type Story = StoryObj

const beforeCode = `import { createSignal } from "solid-js"

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

const afterCode = `import { createSignal, createEffect } from "solid-js"

export function Counter(props: { initial?: number }) {
  const [count, setCount] = createSignal(props.initial ?? 0)

  createEffect(() => {
    document.title = \`Count: \${count()}\`
  })

  const reset = () => setCount(props.initial ?? 0)

  return (
    <div class="counter">
      <p>Count: {count()}</p>
      <button onClick={() => setCount(count() + 1)}>
        Increment
      </button>
      <button onClick={reset}>Reset</button>
    </div>
  )
}
`

const beforeEmpty = ``

const afterAdded = `export const VERSION = "1.0.0"

export function getVersion(): string {
  return VERSION
}
`

const beforeDeleted = `export const LEGACY_API_URL = "https://old.api.example.com"

export function callLegacyApi(endpoint: string) {
  return fetch(\`\${LEGACY_API_URL}/\${endpoint}\`)
}
`

const afterDeleted = ``

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

export const Default: Story = {
  render: () => (
    <Diff before={{ name: "counter.tsx", contents: beforeCode }} after={{ name: "counter.tsx", contents: afterCode }} />
  ),
}

export const SplitView: Story = {
  render: () => (
    <Diff
      before={{ name: "counter.tsx", contents: beforeCode }}
      after={{ name: "counter.tsx", contents: afterCode }}
      diffStyle="split"
    />
  ),
}

export const AddedFile: Story = {
  render: () => (
    <Diff before={{ name: "version.ts", contents: beforeEmpty }} after={{ name: "version.ts", contents: afterAdded }} />
  ),
}

export const DeletedFile: Story = {
  render: () => (
    <Diff
      before={{ name: "legacy.ts", contents: beforeDeleted }}
      after={{ name: "legacy.ts", contents: afterDeleted }}
    />
  ),
}

export const ConfigChange: Story = {
  render: () => (
    <Diff
      before={{ name: "package.json", contents: beforeConfig }}
      after={{ name: "package.json", contents: afterConfig }}
    />
  ),
}
