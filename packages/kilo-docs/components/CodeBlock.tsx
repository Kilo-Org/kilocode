import Prism from "prismjs"

import * as React from "react"
import { Codicon } from "./Codicon"

let mermaidInitialized = false

function MermaidBlock({ children }) {
  const ref = React.useRef(null)
  const [svg, setSvg] = React.useState("")
  const [error, setError] = React.useState(false)

  React.useEffect(() => {
    const code = typeof children === "string" ? children : ref.current?.textContent || ""
    if (!code.trim()) return
    const id = `mermaid-${Math.random().toString(36).slice(2, 9)}`

    import("mermaid").then((mod) => {
      const mermaid = mod.default
      if (!mermaidInitialized) {
        mermaid.initialize({
          startOnLoad: false,
          theme: "base",
          themeVariables: {
            primaryColor: "#33332d",
            primaryTextColor: "#e9e9e9",
            primaryBorderColor: "#555",
            lineColor: "#a3a3a2",
            secondaryColor: "#2a2a24",
            tertiaryColor: "#1a1a18",
            background: "#1a1a18",
            mainBkg: "#33332d",
            nodeBorder: "#555",
            clusterBkg: "#2a2a24",
            clusterBorder: "#444",
            titleColor: "#e9e9e9",
            edgeLabelBackground: "#1a1a18",
          },
          securityLevel: "strict",
          fontFamily: "inherit",
        })
        mermaidInitialized = true
      }
      mermaid
        .render(id, code.trim())
        .then(({ svg }) => setSvg(svg))
        .catch((err) => {
          console.error(err)
          setError(true)
        })
    })
  }, [children])

  if (error) {
    return <pre className="language-mermaid">{children}</pre>
  }

  if (svg) {
    return (
      <div
        className="mermaid-diagram"
        dangerouslySetInnerHTML={{ __html: svg }}
        style={{ display: "flex", justifyContent: "center", padding: "1rem 0" }}
      />
    )
  }

  return (
    <pre ref={ref} style={{ visibility: "hidden", height: 0, overflow: "hidden" }}>
      {children}
    </pre>
  )
}

export function CodeBlock({ children, "data-language": language }) {
  const ref = React.useRef(null)
  const timeoutRef = React.useRef(null)
  const [copied, setCopied] = React.useState(false)

  React.useEffect(() => {
    if (language === "mermaid") return
    if (ref.current) Prism.highlightElement(ref.current, false)
  }, [children, language])

  React.useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }
    }
  }, [])

  if (language === "mermaid") {
    return <MermaidBlock>{children}</MermaidBlock>
  }

  const handleCopy = async () => {
    const code = ref.current?.textContent || ""
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }
      timeoutRef.current = setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error("Failed to copy code:", err)
    }
  }

  return (
    <div className="code" aria-live="polite">
      <button
        type="button"
        className="copy-button"
        onClick={handleCopy}
        aria-label="Copy code to clipboard"
        title={copied ? "Copied!" : "Copy code"}
      >
        {copied ? <Codicon name="check" /> : <Codicon name="copy" />}
      </button>
      <pre ref={ref} className={`language-${language}`}>
        {children}
      </pre>
      <style jsx>
        {`
          .code {
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

          /* Override Prism styles */
          .code :global(pre[class*="language-"]) {
            text-shadow: none;
            border-radius: 4px;
            padding-right: 3.5rem;
          }
        `}
      </style>
    </div>
  )
}
