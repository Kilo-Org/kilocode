"use client"

import React from "react"

/**
 * BrowserFrame wraps content (typically an image) in an abstract browser chrome.
 * Provides a minimal title bar with traffic light dots and an optional URL bar.
 */
export function BrowserFrame({
  children,
  url,
  caption,
}: {
  children: React.ReactNode
  url?: string
  caption?: string
}) {
  return (
    <figure style={{ margin: "24px 0" }}>
      <div
        style={{
          borderRadius: "12px",
          overflow: "hidden",
          border: "1px solid rgba(255,255,255,0.08)",
          background: "#0f0f16",
          boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
        }}
      >
        {/* Title bar */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            padding: "12px 16px",
            background: "#1a1a24",
            borderBottom: "1px solid rgba(255,255,255,0.06)",
          }}
        >
          {/* Traffic lights */}
          <div style={{ display: "flex", gap: "6px" }}>
            <div
              style={{
                width: "10px",
                height: "10px",
                borderRadius: "50%",
                background: "#ff5f57",
              }}
            />
            <div
              style={{
                width: "10px",
                height: "10px",
                borderRadius: "50%",
                background: "#febc2e",
              }}
            />
            <div
              style={{
                width: "10px",
                height: "10px",
                borderRadius: "50%",
                background: "#28c840",
              }}
            />
          </div>
          {/* URL bar */}
          {url && (
            <div
              style={{
                flex: 1,
                marginLeft: "12px",
                padding: "4px 12px",
                borderRadius: "6px",
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.06)",
                fontSize: "11px",
                fontFamily: "'JetBrains Mono', monospace",
                color: "rgba(255,255,255,0.4)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {url}
            </div>
          )}
        </div>
        {/* Content */}
        <div style={{ lineHeight: 0 }}>{children}</div>
      </div>
      {caption && (
        <figcaption
          style={{
            textAlign: "center",
            fontSize: "13px",
            color: "var(--text-muted, #888)",
            marginTop: "8px",
            fontStyle: "italic",
          }}
        >
          {caption}
        </figcaption>
      )}
    </figure>
  )
}
