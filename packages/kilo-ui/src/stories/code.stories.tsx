/** @jsxImportSource solid-js */
import type { Meta, StoryObj } from "storybook-solidjs-vite"
import { Code } from "@opencode-ai/ui/code"

const meta: Meta = {
  title: "Components/Code",
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

const jsCode = `import { createSignal } from "solid-js"

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

const tsCode = `interface User {
  id: string
  name: string
  email: string
  role: "admin" | "user" | "guest"
  createdAt: Date
}

async function fetchUser(id: string): Promise<User> {
  const response = await fetch(\`/api/users/\${id}\`)
  if (!response.ok) {
    throw new Error(\`Failed to fetch user: \${response.statusText}\`)
  }
  return response.json() as Promise<User>
}

export async function updateUser(
  id: string,
  updates: Partial<Omit<User, "id" | "createdAt">>
): Promise<User> {
  const current = await fetchUser(id)
  return { ...current, ...updates }
}
`

const pythonCode = `def fibonacci(n: int) -> list[int]:
    """Generate Fibonacci sequence up to n terms."""
    if n <= 0:
        return []
    if n == 1:
        return [0]

    sequence = [0, 1]
    while len(sequence) < n:
        sequence.append(sequence[-1] + sequence[-2])
    return sequence


class FibonacciCalculator:
    def __init__(self, cache_size: int = 100):
        self._cache: dict[int, int] = {}
        self._cache_size = cache_size

    def compute(self, n: int) -> int:
        if n in self._cache:
            return self._cache[n]
        if n <= 1:
            return n
        result = self.compute(n - 1) + self.compute(n - 2)
        if len(self._cache) < self._cache_size:
            self._cache[n] = result
        return result
`

const shortCode = `const hello = "world"`

export const Default: Story = {
  render: () => <Code file={{ name: "counter.tsx", contents: jsCode }} />,
}

export const TypeScript: Story = {
  render: () => <Code file={{ name: "user.ts", contents: tsCode }} />,
}

export const Python: Story = {
  render: () => <Code file={{ name: "fibonacci.py", contents: pythonCode }} />,
}

export const Short: Story = {
  render: () => <Code file={{ name: "hello.ts", contents: shortCode }} />,
}

export const NoLineNumbers: Story = {
  render: () => <Code file={{ name: "counter.tsx", contents: jsCode }} disableLineNumbers />,
}

export const SplitOverflow: Story = {
  render: () => <Code file={{ name: "counter.tsx", contents: jsCode }} overflow="scroll" />,
}
