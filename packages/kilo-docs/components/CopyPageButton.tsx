import React, { useState, useEffect, useRef } from "react"
import { useRouter } from "next/router"

const GITHUB_REPO = "Kilo-Org/kilocode"
const GITHUB_BRANCH = "main"

interface CopyPageButtonProps {
  className?: string
}

function getRoutePath(asPath: string) {
  const path = asPath.split("#")[0].split("?")[0]
  return path === "/" ? "/index" : path
}

export function CopyPageButton({ className }: CopyPageButtonProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (copied || error) {
      const timer = setTimeout(() => {
        setCopied(false)
        setError(false)
      }, 3000)
      return () => clearTimeout(timer)
    }
  }, [copied, error])

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }

    if (open) {
      document.addEventListener("mousedown", handleClickOutside)
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside)
    }
  }, [open])

  const handleCopy = async () => {
    if (copied || error || isLoading) return

    setIsLoading(true)
    setOpen(false)

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
    setOpen(false)

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

  const label = copied ? "Copied" : error ? "Copy failed" : "Copy page"

  return (
    <>
      <div ref={ref} className={`page-actions ${className || ""}`}>
        <button
          onClick={handleCopy}
          disabled={copied || error || isLoading}
          className={`action-button ${copied ? "copied" : ""} ${error ? "errored" : ""}`}
          aria-label={label}
          title="Copy page as markdown for use with LLMs"
        >
          {copied ? <CheckIcon /> : <CopyIcon />}
          <span>{label}</span>
        </button>
        <button
          onClick={() => setOpen(!open)}
          className={`chevron-button ${open ? "active" : ""}`}
          aria-label="More actions"
          aria-expanded={open}
        >
          <ChevronDownIcon />
        </button>

        {open && (
          <div className="dropdown">
            <button className="dropdown-item" onClick={handleCopy} disabled={isLoading}>
              <CopyIcon />
              <span>Copy page</span>
            </button>
            <button className="dropdown-item" onClick={() => openGitHubUrl("raw")}>
              <FileIcon />
              <span>Open markdown</span>
            </button>
            <button className="dropdown-item" onClick={() => openGitHubUrl("edit")}>
              <EditIcon />
              <span>Edit page</span>
            </button>
          </div>
        )}
      </div>
      <style jsx>{`
        .page-actions {
          position: relative;
          display: inline-flex;
          align-items: stretch;
        }

        .action-button {
          display: inline-flex;
          align-items: center;
          gap: 0.5rem;
          padding: 0.25rem 0.5rem;
          font-size: 0.875rem;
          font-weight: 500;
          font-family: inherit;
          color: var(--text-secondary);
          background: var(--bg-secondary);
          border: 1px solid var(--border-color);
          border-radius: 0.5rem 0 0 0.5rem;
          cursor: pointer;
          transition: all 0.15s ease;
          white-space: nowrap;
        }

        .page-actions:hover .action-button:not(:disabled),
        .page-actions:hover .chevron-button {
          background: var(--bg-tertiary, var(--bg-secondary));
          color: var(--text-brand);
          border-color: var(--text-brand);
        }

        .action-button:disabled {
          cursor: default;
        }

        .action-button.copied,
        .page-actions:hover .action-button.copied {
          color: var(--success-color, #22c55e);
          border-color: var(--success-color, #22c55e);
          background: var(--success-bg, rgba(34, 197, 94, 0.1));
        }

        .action-button.errored,
        .page-actions:hover .action-button.errored {
          color: var(--error-color, #ef4444);
          border-color: var(--error-color, #ef4444);
          background: var(--error-bg, rgba(239, 68, 68, 0.1));
        }

        .chevron-button {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          padding: 0.25rem 0.35rem;
          font-family: inherit;
          color: var(--text-secondary);
          background: var(--bg-secondary);
          border: 1px solid var(--border-color);
          border-left: none;
          border-radius: 0 0.5rem 0.5rem 0;
          cursor: pointer;
          transition: all 0.15s ease;
        }

        .chevron-button.active {
          color: var(--text-brand);
          border-color: var(--text-brand);
        }

        .dropdown {
          position: absolute;
          top: calc(100% + 0.375rem);
          left: 0;
          min-width: 180px;
          background: var(--bg-color);
          border: 1px solid var(--border-color);
          border-radius: 0.5rem;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
          z-index: 50;
          padding: 0.25rem;
        }

        .dropdown-item {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          width: 100%;
          padding: 0.5rem 0.625rem;
          font-size: 0.875rem;
          font-weight: 500;
          font-family: inherit;
          color: var(--text-secondary);
          background: transparent;
          border: none;
          border-radius: 0.375rem;
          cursor: pointer;
          transition: all 0.15s ease;
          white-space: nowrap;
          text-align: left;
        }

        .dropdown-item:hover:not(:disabled) {
          background: var(--bg-secondary);
          color: var(--text-color);
        }

        .dropdown-item:disabled {
          opacity: 0.5;
          cursor: default;
        }
      `}</style>
    </>
  )
}

function CopyIcon() {
  return (
    <svg
      width="16"
      height="16"
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
      width="16"
      height="16"
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

function ChevronDownIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M2.5 4.5L6 8L9.5 4.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function FileIcon() {
  return (
    <svg
      width="16"
      height="16"
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
      width="16"
      height="16"
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
