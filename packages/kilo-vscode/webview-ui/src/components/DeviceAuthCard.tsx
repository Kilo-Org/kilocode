import { Component, Show, Switch, Match, createSignal, createEffect, onCleanup } from "solid-js"
import { useVSCode } from "../context/vscode"
import { generateQRCode } from "../utils/qrcode"
import type { DeviceAuthStatus } from "../types/messages"

interface DeviceAuthCardProps {
  status: DeviceAuthStatus
  code?: string
  verificationUrl?: string
  expiresIn?: number
  error?: string
  onCancel: () => void
  onRetry: () => void
}

const formatTime = (seconds: number): string => {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${s.toString().padStart(2, "0")}`
}

const DeviceAuthCard: Component<DeviceAuthCardProps> = (props) => {
  const vscode = useVSCode()
  const [timeRemaining, setTimeRemaining] = createSignal(props.expiresIn ?? 900)
  const [qrDataUrl, setQrDataUrl] = createSignal("")
  const [copied, setCopied] = createSignal(false)

  // Countdown timer
  createEffect(() => {
    if (props.status !== "pending") {
      return
    }
    setTimeRemaining(props.expiresIn ?? 900)
    const interval = setInterval(() => {
      setTimeRemaining((prev) => Math.max(0, prev - 1))
    }, 1000)
    onCleanup(() => clearInterval(interval))
  })

  // QR code generation
  createEffect(() => {
    const url = props.verificationUrl
    if (url) {
      generateQRCode(url).then(setQrDataUrl).catch(console.error)
    }
  })

  const handleCopyUrl = () => {
    if (props.verificationUrl) {
      navigator.clipboard.writeText(props.verificationUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  const handleCopyCode = () => {
    if (props.code) {
      navigator.clipboard.writeText(props.code)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  const handleOpenBrowser = () => {
    if (props.verificationUrl) {
      vscode.postMessage({ type: "openExternal", url: props.verificationUrl })
    }
  }

  const cardStyle = {
    background: "var(--vscode-editor-background)",
    border: "1px solid var(--vscode-panel-border)",
    "border-radius": "4px",
    padding: "20px",
  }

  return (
    <Switch>
      {/* Initiating state */}
      <Match when={props.status === "initiating"}>
        <div style={cardStyle}>
          <div style={{ display: "flex", "align-items": "center", gap: "8px" }}>
            <span style={{ "font-size": "14px", animation: "spin 1s linear infinite" }}>⏳</span>
            <span style={{ "font-size": "13px", color: "var(--vscode-descriptionForeground)" }}>Starting login...</span>
          </div>
        </div>
      </Match>

      {/* Pending state — main card */}
      <Match when={props.status === "pending"}>
        <div style={cardStyle}>
          <h3
            style={{
              "font-size": "15px",
              "font-weight": "600",
              color: "var(--vscode-foreground)",
              margin: "0 0 16px 0",
              "text-align": "center",
            }}
          >
            Sign in to Kilo Code
          </h3>

          {/* Step 1: URL */}
          <div style={{ "margin-bottom": "12px" }}>
            <p
              style={{
                "font-size": "12px",
                "font-weight": "600",
                color: "var(--vscode-descriptionForeground)",
                margin: "0 0 6px 0",
                "text-transform": "uppercase",
                "letter-spacing": "0.5px",
              }}
            >
              Step 1: Open this URL
            </p>
            <div
              style={{
                display: "flex",
                gap: "4px",
                "align-items": "center",
              }}
            >
              <div
                style={{
                  flex: "1",
                  background: "var(--vscode-input-background)",
                  border: "1px solid var(--vscode-input-border, var(--vscode-panel-border))",
                  "border-radius": "3px",
                  padding: "6px 8px",
                  "font-size": "12px",
                  color: "var(--vscode-input-foreground)",
                  overflow: "hidden",
                  "text-overflow": "ellipsis",
                  "white-space": "nowrap",
                }}
              >
                {props.verificationUrl}
              </div>
              <button
                onClick={handleCopyUrl}
                title="Copy URL"
                style={{
                  background: "var(--vscode-button-secondaryBackground)",
                  color: "var(--vscode-button-secondaryForeground)",
                  border: "none",
                  "border-radius": "3px",
                  padding: "6px 8px",
                  cursor: "pointer",
                  "font-size": "12px",
                  "white-space": "nowrap",
                }}
              >
                {copied() ? "✓" : "📋"}
              </button>
              <button
                onClick={handleOpenBrowser}
                style={{
                  background: "var(--vscode-button-secondaryBackground)",
                  color: "var(--vscode-button-secondaryForeground)",
                  border: "none",
                  "border-radius": "3px",
                  padding: "6px 8px",
                  cursor: "pointer",
                  "font-size": "12px",
                  "white-space": "nowrap",
                }}
              >
                Open Browser
              </button>
            </div>
          </div>

          {/* QR Code */}
          <Show when={qrDataUrl()}>
            <div
              style={{
                display: "flex",
                "justify-content": "center",
                "margin-bottom": "12px",
              }}
            >
              <img
                src={qrDataUrl()}
                alt="QR Code"
                style={{
                  width: "160px",
                  height: "160px",
                  "border-radius": "4px",
                }}
              />
            </div>
          </Show>

          {/* Step 2: Verification code */}
          <Show when={props.code}>
            <div style={{ "margin-bottom": "16px" }}>
              <p
                style={{
                  "font-size": "12px",
                  "font-weight": "600",
                  color: "var(--vscode-descriptionForeground)",
                  margin: "0 0 6px 0",
                  "text-transform": "uppercase",
                  "letter-spacing": "0.5px",
                }}
              >
                Step 2: Enter this code
              </p>
              <div
                onClick={handleCopyCode}
                style={{
                  background: "var(--vscode-input-background)",
                  border: "2px solid var(--vscode-focusBorder, var(--vscode-panel-border))",
                  "border-radius": "4px",
                  padding: "12px",
                  "text-align": "center",
                  cursor: "pointer",
                }}
                title="Click to copy"
              >
                <span
                  style={{
                    "font-size": "24px",
                    "font-weight": "700",
                    "font-family": "var(--vscode-editor-font-family, monospace)",
                    "letter-spacing": "4px",
                    color: "var(--vscode-foreground)",
                  }}
                >
                  {props.code}
                </span>
                <p
                  style={{
                    "font-size": "11px",
                    color: "var(--vscode-descriptionForeground)",
                    margin: "4px 0 0 0",
                  }}
                >
                  Click to copy
                </p>
              </div>
            </div>
          </Show>

          {/* Timer + waiting */}
          <div
            style={{
              display: "flex",
              "align-items": "center",
              "justify-content": "center",
              gap: "8px",
              "margin-bottom": "12px",
            }}
          >
            <span
              style={{
                "font-size": "12px",
                color: "var(--vscode-descriptionForeground)",
              }}
            >
              ⏳ Waiting for authorization... ({formatTime(timeRemaining())})
            </span>
          </div>

          {/* Cancel button */}
          <button
            onClick={props.onCancel}
            style={{
              width: "100%",
              background: "none",
              color: "var(--vscode-descriptionForeground)",
              border: "1px solid var(--vscode-panel-border)",
              "border-radius": "4px",
              padding: "8px 12px",
              cursor: "pointer",
              "font-size": "13px",
            }}
          >
            Cancel
          </button>
        </div>
      </Match>

      {/* Success state */}
      <Match when={props.status === "success"}>
        <div style={cardStyle}>
          <div style={{ "text-align": "center" }}>
            <span style={{ "font-size": "24px" }}>✅</span>
            <p
              style={{
                "font-size": "14px",
                "font-weight": "600",
                color: "var(--vscode-foreground)",
                margin: "8px 0 0 0",
              }}
            >
              Login successful!
            </p>
          </div>
        </div>
      </Match>

      {/* Error state */}
      <Match when={props.status === "error"}>
        <div style={cardStyle}>
          <div style={{ "text-align": "center" }}>
            <span style={{ "font-size": "24px" }}>❌</span>
            <p
              style={{
                "font-size": "13px",
                color: "var(--vscode-errorForeground)",
                margin: "8px 0 12px 0",
              }}
            >
              {props.error || "Login failed"}
            </p>
            <button
              onClick={props.onRetry}
              style={{
                background: "var(--vscode-button-background)",
                color: "var(--vscode-button-foreground)",
                border: "none",
                "border-radius": "4px",
                padding: "8px 16px",
                cursor: "pointer",
                "font-size": "13px",
                "font-weight": "600",
              }}
            >
              Retry
            </button>
          </div>
        </div>
      </Match>

      {/* Cancelled state */}
      <Match when={props.status === "cancelled"}>
        <div style={cardStyle}>
          <div style={{ "text-align": "center" }}>
            <p
              style={{
                "font-size": "13px",
                color: "var(--vscode-descriptionForeground)",
                margin: "0 0 12px 0",
              }}
            >
              Login cancelled
            </p>
            <button
              onClick={props.onRetry}
              style={{
                background: "var(--vscode-button-background)",
                color: "var(--vscode-button-foreground)",
                border: "none",
                "border-radius": "4px",
                padding: "8px 16px",
                cursor: "pointer",
                "font-size": "13px",
                "font-weight": "600",
              }}
            >
              Try Again
            </button>
          </div>
        </div>
      </Match>
    </Switch>
  )
}

export default DeviceAuthCard
