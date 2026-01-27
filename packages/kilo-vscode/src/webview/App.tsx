import { createSignal, createEffect } from "solid-js"

interface State {
  count: number
}

const vscode = acquireVsCodeApi<State>()

function getInitialState(): State {
  return vscode.getState() ?? { count: 0 }
}

export default function App() {
  const initial = getInitialState()
  const [count, setCount] = createSignal(initial.count)

  createEffect(() => {
    vscode.setState({ count: count() })
  })

  function increment() {
    setCount((c) => c + 1)
    vscode.postMessage({ type: "increment", count: count() })
  }

  return (
    <div class="container">
      <h1>Kilo Sidebar</h1>
      <p>Welcome to the Kilo VS Code extension sidebar.</p>
      <div class="counter">
        <button onClick={increment}>Count: {count()}</button>
      </div>
    </div>
  )
}
