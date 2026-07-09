import * as React from "react"
import { Codicon } from "./Codicon"

interface CopyLineProps {
  text: string
}

export function CopyLine({ text }: CopyLineProps) {
  const timeout = React.useRef(null)
  const [copied, setCopied] = React.useState(false)

  React.useEffect(() => {
    return () => {
      if (timeout.current) {
        clearTimeout(timeout.current)
      }
    }
  }, [])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      if (timeout.current) {
        clearTimeout(timeout.current)
      }
      timeout.current = setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error("Failed to copy line:", err)
    }
  }

  return (
    <div className="copy-line" aria-live="polite">
      <button
        type="button"
        className="copy-button"
        onClick={copy}
        aria-label="Copy text to clipboard"
        title={copied ? "Copied!" : "Copy text"}
      >
        {copied ? <Codicon name="check" /> : <Codicon name="copy" />}
      </button>
      <pre className="language-text">
        <code>{text}</code>
      </pre>
      <style jsx>
        {`
          .copy-line {
            position: relative;
          }

          .copy-button {
            position: absolute;
            top: 8px;
            right: 8px;
            padding: 6px 8px;
            background: rgba(0, 0, 0, 0.05);
            border: 1px solid rgba(0, 0, 0, 0.1);
            border-radius: 4px;
            color: rgba(0, 0, 0, 0.4);
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: all 0.2s ease;
            z-index: 10;
          }

          .copy-button:hover {
            background: rgba(0, 0, 0, 0.1);
            color: rgba(0, 0, 0, 0.6);
            border-color: rgba(0, 0, 0, 0.2);
          }

          :global(.dark) .copy-button {
            background: rgba(255, 255, 255, 0.05);
            border-color: rgba(255, 255, 255, 0.1);
            color: rgba(255, 255, 255, 0.4);
          }

          :global(.dark) .copy-button:hover {
            background: rgba(255, 255, 255, 0.1);
            color: rgba(255, 255, 255, 0.7);
            border-color: rgba(255, 255, 255, 0.2);
          }

          .copy-button:active {
            transform: scale(0.95);
          }

          .copy-line :global(pre) {
            padding-right: 3.5rem;
          }
        `}
      </style>
    </div>
  )
}
