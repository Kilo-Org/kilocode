import { Component, Show, Switch, Match, createSignal, createEffect, onCleanup } from "solid-js"
import { Button } from "@kilocode/kilo-ui/button"
import { Card } from "@kilocode/kilo-ui/card"
import { Spinner } from "@kilocode/kilo-ui/spinner"
import { showToast } from "@kilocode/kilo-ui/toast"
import { useDialog } from "@kilocode/kilo-ui/context/dialog"
import { Dialog } from "@kilocode/kilo-ui/dialog"
import { useVSCode } from "../../context/vscode"
import { useLanguage } from "../../context/language"
import { generateQRCode } from "../../utils/qrcode"
import type { DeviceAuthStatus } from "../../types/messages"

interface DeviceAuthCardProps {
  status: DeviceAuthStatus
  code?: string
  verificationUrl?: string
  expiresIn?: number
  error?: string
  onCancel: () => void
  onRetry: () => void
}

const ERROR_LIMIT = 180

const formatTime = (seconds: number): string => {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${s.toString().padStart(2, "0")}`
}

function compactError(error: string | undefined, fallback: string) {
  if (!error) return fallback

  const text = error.replace(/\s+/g, " ").trim()
  const html = text.search(/<!doctype html|<html|<head|<body/i)
  const head =
    html >= 0
      ? text
          .slice(0, html)
          .trim()
          .replace(/[\s:,-]+$/, "")
      : text

  if (head.length > 0) {
    if (head.length <= ERROR_LIMIT) return head
    return `${head.slice(0, ERROR_LIMIT).trimEnd()}...`
  }

  const status = text.match(/\b([45]\d{2})\b/)?.[1]
  if (status) return `${fallback} (${status})`
  return fallback
}

const DeviceAuthCard: Component<DeviceAuthCardProps> = (props) => {
  const vscode = useVSCode()
  const language = useLanguage()
  const dialog = useDialog()
  const [timeRemaining, setTimeRemaining] = createSignal(props.expiresIn ?? 900)
  const [qrDataUrl, setQrDataUrl] = createSignal("")

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
      showToast({ variant: "success", title: language.t("deviceAuth.toast.urlCopied") })
    }
  }

  const handleCopyCode = () => {
    if (props.code) {
      navigator.clipboard.writeText(props.code)
      showToast({ variant: "success", title: language.t("deviceAuth.toast.codeCopied") })
    }
  }

  const handleOpenBrowser = () => {
    if (props.verificationUrl) {
      vscode.postMessage({ type: "openExternal", url: props.verificationUrl })
    }
  }

  const errorSummary = () => compactError(props.error, language.t("deviceAuth.status.failed"))

  const hasErrorDetails = () => {
    if (!props.error) return false
    return errorSummary() !== props.error.replace(/\s+/g, " ").trim()
  }

  const handleCopyError = () => {
    if (!props.error) return
    navigator.clipboard.writeText(props.error)
    showToast({ variant: "success", title: language.t("deviceAuth.toast.errorCopied") })
  }

  const handleShowError = () => {
    if (!props.error) return

    dialog.show(() => (
      <Dialog title={language.t("deviceAuth.error.detailsTitle")} fit>
        <div style={{ display: "flex", "flex-direction": "column", gap: "12px", width: "min(720px, 80vw)" }}>
          <pre
            style={{
              margin: 0,
              padding: "12px",
              "max-height": "50vh",
              overflow: "auto",
              background: "var(--vscode-textCodeBlock-background, var(--vscode-editorWidget-background))",
              color: "var(--vscode-foreground)",
              border: "1px solid var(--border-weak-base, var(--vscode-panel-border))",
              "border-radius": "6px",
              "font-size": "12px",
              "line-height": "1.5",
              "white-space": "pre-wrap",
              "word-break": "break-word",
            }}
          >
            {props.error}
          </pre>
          <div class="dialog-confirm-actions">
            <Button variant="secondary" size="large" onClick={handleCopyError}>
              {language.t("deviceAuth.action.copyError")}
            </Button>
            <Button variant="primary" size="large" onClick={() => dialog.close()}>
              {language.t("common.close")}
            </Button>
          </div>
        </div>
      </Dialog>
    ))
  }

  return (
    <Switch>
      {/* Initiating state */}
      <Match when={props.status === "initiating"}>
        <Card>
          <div style={{ display: "flex", "align-items": "center", gap: "8px" }}>
            <Spinner style={{ width: "14px", height: "14px" }} />
            <span style={{ "font-size": "13px", color: "var(--vscode-descriptionForeground)" }}>
              {language.t("deviceAuth.status.initiating")}
            </span>
          </div>
        </Card>
      </Match>

      {/* Pending state — main card */}
      <Match when={props.status === "pending"}>
        <Card>
          <h3
            style={{
              "font-size": "15px",
              "font-weight": "600",
              color: "var(--vscode-foreground)",
              margin: "0 0 16px 0",
              "text-align": "center",
            }}
          >
            {language.t("deviceAuth.title")}
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
              {language.t("deviceAuth.step1")}
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
              <Button
                variant="secondary"
                size="small"
                onClick={handleCopyUrl}
                title={language.t("deviceAuth.action.copyUrl")}
              >
                📋
              </Button>
              <Button variant="secondary" size="small" onClick={handleOpenBrowser}>
                {language.t("deviceAuth.action.openBrowser")}
              </Button>
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
                alt={language.t("deviceAuth.qrCode.alt")}
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
                {language.t("deviceAuth.step2")}
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
                title={language.t("deviceAuth.action.clickToCopy")}
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
                  {language.t("deviceAuth.action.clickToCopy")}
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
            <Spinner style={{ width: "12px", height: "12px" }} />
            <span
              style={{
                "font-size": "12px",
                color: "var(--vscode-descriptionForeground)",
              }}
            >
              {language.t("deviceAuth.status.waiting")} ({formatTime(timeRemaining())})
            </span>
          </div>

          {/* Cancel button */}
          <Button variant="ghost" onClick={props.onCancel} style={{ width: "100%" }}>
            {language.t("common.cancel")}
          </Button>
        </Card>
      </Match>

      {/* Success state */}
      <Match when={props.status === "success"}>
        <Card>
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
              {language.t("deviceAuth.status.success")}
            </p>
          </div>
        </Card>
      </Match>

      {/* Error state */}
      <Match when={props.status === "error"}>
        <Card>
          <div style={{ "text-align": "center" }}>
            <span style={{ "font-size": "24px" }}>❌</span>
            <p
              style={{
                "font-size": "13px",
                color: "var(--vscode-errorForeground)",
                margin: "8px 0 12px 0",
              }}
            >
              {errorSummary()}
            </p>
            <div style={{ display: "flex", gap: "8px", "justify-content": "center", "flex-wrap": "wrap" }}>
              <Show when={props.error}>
                <Button variant="secondary" onClick={handleCopyError}>
                  {language.t("deviceAuth.action.copyError")}
                </Button>
              </Show>
              <Show when={hasErrorDetails()}>
                <Button variant="ghost" onClick={handleShowError}>
                  {language.t("deviceAuth.action.showDetails")}
                </Button>
              </Show>
              <Button variant="primary" onClick={props.onRetry}>
                {language.t("common.retry")}
              </Button>
            </div>
          </div>
        </Card>
      </Match>

      {/* Cancelled state */}
      <Match when={props.status === "cancelled"}>
        <Card>
          <div style={{ "text-align": "center" }}>
            <p
              style={{
                "font-size": "13px",
                color: "var(--vscode-descriptionForeground)",
                margin: "0 0 12px 0",
              }}
            >
              {language.t("deviceAuth.status.cancelled")}
            </p>
            <Button variant="primary" onClick={props.onRetry}>
              {language.t("deviceAuth.action.tryAgain")}
            </Button>
          </div>
        </Card>
      </Match>
    </Switch>
  )
}

export default DeviceAuthCard
