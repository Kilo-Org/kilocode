import React from "react"
import { useVersion } from "../lib/VersionContext"

export function VersionToggle() {
  const { version, setVersion } = useVersion()

  return (
    <div className="version-toggle">
      <button
        className={`version-toggle-btn ${version === "classic" ? "active" : ""}`}
        onClick={() => setVersion("classic")}
        aria-pressed={version === "classic"}
      >
        Classic
      </button>
      <button
        className={`version-toggle-btn ${version === "next" ? "active" : ""}`}
        onClick={() => setVersion("next")}
        aria-pressed={version === "next"}
      >
        New
      </button>

      <style jsx>{`
        .version-toggle {
          display: flex;
          align-items: center;
          background-color: var(--bg-secondary);
          border: 1px solid var(--border-color);
          border-radius: 0.375rem;
          padding: 2px;
          gap: 2px;
        }

        .version-toggle-btn {
          padding: 0.25rem 0.625rem;
          font-size: 0.75rem;
          font-weight: 500;
          border: none;
          border-radius: 0.25rem;
          cursor: pointer;
          transition:
            background-color 0.15s ease,
            color 0.15s ease;
          background: transparent;
          color: var(--text-secondary);
          font-family: inherit;
          line-height: 1.4;
        }

        .version-toggle-btn:hover {
          color: var(--text-color);
        }

        .version-toggle-btn.active {
          background-color: var(--bg-color);
          color: var(--text-color);
          box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
        }
      `}</style>
    </div>
  )
}
