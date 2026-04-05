import React, { useState, useEffect } from "react"
import { useRouter } from "next/router"

const GITHUB_REPO = "Kilo-Org/kilocode"
const GITHUB_BRANCH = "main"

function getRoutePath(asPath: string) {
  const path = asPath.split("#")[0].split("?")[0]
  return path === "/" ? "/index" : path
}

export function PageFooter() {
  const router = useRouter()
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState(false)
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    if (copied || error) {
      const timer = setTimeout(() => {
        setCopied(false)
        setError(false)
      }, 3000)
      return () => clearTimeout(timer)
    }
  }, [copied, error])

  const handleCopy = async () => {
    if (copied || error || isLoading) return

    setIsLoading(true)

    try {
      const mdPath = getRoutePath(router.asPath)
      const response = await fetch(`/docs/api/raw-markdown?path=${encodeURIComponent(mdPath)}`)

      if (!response.ok) {
        throw new Error("Failed to fetch markdown")
      }

      const markdown = await response.text()
      await navigator.clipboard.writeText(markdown)
      setCopied(true)
    } catch (err) {
      console.error("Failed to copy page:", err)
      setError(true)
    } finally {
      setIsLoading(false)
    }
  }

  const openGitHubUrl = async (mode: "raw" | "edit") => {
    try {
      const mdPath = getRoutePath(router.asPath)
      const response = await fetch(`/docs/api/resolve-path?path=${encodeURIComponent(mdPath)}`)

      if (!response.ok) {
        throw new Error("Failed to resolve file path")
      }

      const { filePath } = await response.json()

      const url =
        mode === "raw"
          ? `https://raw.githubusercontent.com/${GITHUB_REPO}/${GITHUB_BRANCH}/${filePath}`
          : `https://github.com/${GITHUB_REPO}/edit/${GITHUB_BRANCH}/${filePath}`

      window.open(url, "_blank", "noopener,noreferrer")
    } catch (err) {
      console.error(`Failed to open ${mode} URL:`, err)
    }
  }

  const copyLabel = copied ? "Copied" : error ? "Copy failed" : "Copy page"

  return (
    <>
      <footer className="page-footer">
        <div className="footer-divider" />
        <div className="footer-actions">
          <button
            onClick={handleCopy}
            disabled={copied || error || isLoading}
            className={`footer-action ${copied ? "copied" : ""} ${error ? "errored" : ""}`}
            title="Copy page as markdown for use with LLMs"
          >
            {copied ? <CheckIcon /> : <CopyIcon />}
            <span>{copyLabel}</span>
          </button>
          <button
            onClick={() => openGitHubUrl("raw")}
            className="footer-action"
            title="Open raw markdown file on GitHub"
          >
            <FileIcon />
            <span>Open markdown</span>
          </button>
          <button onClick={() => openGitHubUrl("edit")} className="footer-action" title="Edit this page on GitHub">
            <EditIcon />
            <span>Edit page</span>
          </button>
        </div>
      </footer>
      <style jsx>{`
        .page-footer {
          margin-top: 3rem;
          padding-bottom: 1rem;
        }

        .footer-divider {
          height: 1px;
          background: var(--border-color);
          margin-bottom: 1rem;
        }

        .footer-actions {
          display: flex;
          align-items: center;
          gap: 0.25rem;
          flex-wrap: wrap;
        }

        .footer-action {
          display: inline-flex;
          align-items: center;
          gap: 0.375rem;
          padding: 0.375rem 0.625rem;
          font-size: 0.8125rem;
          font-weight: 500;
          font-family: inherit;
          color: var(--text-secondary);
          background: transparent;
          border: 1px solid transparent;
          border-radius: 0.375rem;
          cursor: pointer;
          transition: all 0.15s ease;
          white-space: nowrap;
        }

        .footer-action:hover:not(:disabled) {
          color: var(--text-brand);
          background: var(--bg-secondary);
          border-color: var(--border-color);
        }

        .footer-action:disabled {
          cursor: default;
        }

        .footer-action.copied {
          color: var(--success-color, #22c55e);
        }

        .footer-action.errored {
          color: var(--error-color, #ef4444);
        }
      `}</style>
    </>
  )
}

function CopyIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="5" y="5" width="9" height="9" rx="1.5" />
      <path d="M2 10V3.5A1.5 1.5 0 0 1 3.5 2H10" />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 8.5L6.5 12L13 4" />
    </svg>
  )
}

function FileIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M9 1H4a1.5 1.5 0 0 0-1.5 1.5v11A1.5 1.5 0 0 0 4 15h8a1.5 1.5 0 0 0 1.5-1.5V5.5L9 1Z" />
      <path d="M9 1v5h4.5" />
    </svg>
  )
}

function EditIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M11.5 1.5a2.121 2.121 0 0 1 3 3L5 14l-4 1 1-4 9.5-9.5Z" />
    </svg>
  )
}
