import React from "react"
import Link from "next/link"
import { useVersion } from "../lib/VersionContext"
import type { Platform } from "../lib/types"

interface PageVersionSwitcherProps {
  platform?: Platform
  alternateVersion?: string
}

export function PageVersionSwitcher({ platform, alternateVersion }: PageVersionSwitcherProps) {
  const { setVersion } = useVersion()

  // Don't render anything for universal pages
  if (!platform || platform === "all") return null

  // If there's a counterpart page, show the pill switcher
  if (alternateVersion) {
    const isClassic = platform === "classic"
    return (
      <div className="page-version-switcher">
        {isClassic ? (
          <>
            <span className="switcher-option active">Classic Extension</span>
            <Link href={alternateVersion} className="switcher-option" onClick={() => setVersion("next")}>
              New CLI &amp; Extension
            </Link>
          </>
        ) : (
          <>
            <Link href={alternateVersion} className="switcher-option" onClick={() => setVersion("classic")}>
              Classic Extension
            </Link>
            <span className="switcher-option active">New CLI &amp; Extension</span>
          </>
        )}

        <style jsx>{`
          .page-version-switcher {
            display: inline-flex;
            align-items: center;
            background-color: var(--bg-secondary);
            border: 1px solid var(--border-color);
            border-radius: 0.5rem;
            padding: 3px;
            gap: 3px;
            margin-bottom: 1.5rem;
          }

          .switcher-option {
            padding: 0.375rem 0.875rem;
            font-size: 0.8125rem;
            font-weight: 500;
            border-radius: 0.375rem;
            cursor: pointer;
            transition:
              background-color 0.15s ease,
              color 0.15s ease;
            color: var(--text-secondary);
            text-decoration: none;
            white-space: nowrap;
          }

          .switcher-option:hover {
            color: var(--text-color);
          }

          .switcher-option.active {
            background-color: var(--bg-color);
            color: var(--text-color);
            box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
            cursor: default;
          }
        `}</style>
      </div>
    )
  }

  // No counterpart — show an info banner
  const isClassic = platform === "classic"
  return (
    <div className={`version-banner ${isClassic ? "banner-classic" : "banner-next"}`}>
      <span className="version-banner-icon">{isClassic ? "\u24D8" : "\u2728"}</span>
      <span>
        {isClassic
          ? "This page documents the Classic Kilo Code extension (v5.x). The New CLI & extension does not have an equivalent page yet."
          : "This page documents the New Kilo CLI & extension (v7.x+). There is no Classic equivalent for this page."}
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
