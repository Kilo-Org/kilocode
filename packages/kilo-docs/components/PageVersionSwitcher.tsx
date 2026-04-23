import React from "react"
import type { Platform } from "../lib/types"

interface Props {
  platform?: Platform
}

export function PageVersionSwitcher({ platform }: Props) {
  if (!platform || platform === "all") return null

  const legacy = platform === "legacy"
  return (
    <div className="version-banner">
      <span className="version-banner-icon">{legacy ? "\u24D8" : "\u2728"}</span>
      <span>
        {legacy
          ? "This page applies to the legacy VSCode extension."
          : "This page applies to the current VSCode extension & CLI."}
      </span>

      <style jsx>{`
        .version-banner {
          display: flex;
          align-items: flex-start;
          gap: 0.625rem;
          padding: 0.75rem 1rem;
          border-radius: 0.5rem;
          font-size: 0.875rem;
          line-height: 1.5;
          margin-top: 1rem;
          margin-bottom: 1.5rem;
          border: 1px solid var(--border-color);
          background-color: var(--bg-secondary);
          color: var(--text-color);
        }

        .version-banner-icon {
          flex-shrink: 0;
          font-size: 1rem;
          line-height: 1.5;
        }
      `}</style>
    </div>
  )
}
