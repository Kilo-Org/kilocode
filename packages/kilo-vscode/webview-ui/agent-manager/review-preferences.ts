import { createSignal } from "solid-js"

interface VscodeLike {
  postMessage: (message: { type: "agentManager.setReviewMarkdownRender"; render: boolean }) => void
}

export function createMarkdownRender(vscode: VscodeLike) {
  const [render, setRender] = createSignal(false)
  const update = (value: boolean) => {
    if (render() === value) return
    setRender(value)
    vscode.postMessage({ type: "agentManager.setReviewMarkdownRender", render: value })
  }

  return { render, setRender, update }
}
