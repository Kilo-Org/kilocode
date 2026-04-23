// KiloClaw status sidebar — instance info, bot presence, details

import { Show, createMemo } from "solid-js"
import { useClaw } from "../context/claw"
import { useKiloClawLanguage } from "../context/language"

function dot(status: string | null | undefined): string {
  if (!status) return "kiloclaw-dot-offline"
  if (status === "running") return "kiloclaw-dot-online"
  if (status === "starting" || status === "restarting") return "kiloclaw-dot-warning"
  if (status === "destroying") return "kiloclaw-dot-error"
  return "kiloclaw-dot-offline"
}

function uptime(started: string | null | undefined): string {
  if (!started) return "\u2014"
  const ms = Date.now() - new Date(started).getTime()
  if (ms < 0) return "\u2014"
  const seconds = Math.floor(ms / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)
  if (days > 0) return `${days}d ${hours % 24}h`
  if (hours > 0) return `${hours}h ${minutes % 60}m`
  if (minutes > 0) return `${minutes}m`
  return `${seconds}s`
}

function capitalize(s: string | null | undefined, fallback: string): string {
  if (!s) return fallback
  return s.charAt(0).toUpperCase() + s.slice(1)
}

export function StatusSidebar() {
  const claw = useClaw()
  const { t } = useKiloClawLanguage()
  const status = createMemo(() => claw.status())

  return (
    <div class="kiloclaw-sidebar">
      <h3 class="kiloclaw-sidebar-title">{t("kiloClaw.sidebar.title")}</h3>

      <Show when={status()}>
        <div class="kiloclaw-sidebar-section">
          <div class="kiloclaw-sidebar-label">{t("kiloClaw.sidebar.instance")}</div>
          <div class="kiloclaw-sidebar-row">
            <span class={`kiloclaw-dot ${dot(status()!.status)}`} />
            <span>
              {capitalize(status()!.status, t("kiloClaw.sidebar.unknown"))}
              <Show when={status()!.status === "running"}>
                <span class="kiloclaw-sidebar-muted"> {uptime(status()!.lastStartedAt)}</span>
              </Show>
            </span>
          </div>
        </div>

        <div class="kiloclaw-sidebar-section">
          <div class="kiloclaw-sidebar-label">{t("kiloClaw.sidebar.bot")}</div>
          <div class="kiloclaw-sidebar-row">
            <span class={`kiloclaw-dot ${claw.online() ? "kiloclaw-dot-online" : "kiloclaw-dot-offline"}`} />
            <span>{claw.online() ? t("kiloClaw.chat.online") : t("kiloClaw.chat.offline")}</span>
          </div>
        </div>

        <div class="kiloclaw-sidebar-section">
          <div class="kiloclaw-sidebar-label">{t("kiloClaw.sidebar.details")}</div>
          <div class="kiloclaw-sidebar-detail">
            <span class="kiloclaw-sidebar-muted">{t("kiloClaw.sidebar.region")}</span>
            <span>{status()!.flyRegion?.toUpperCase() ?? "\u2014"}</span>
          </div>
          <div class="kiloclaw-sidebar-detail">
            <span class="kiloclaw-sidebar-muted">{t("kiloClaw.sidebar.version")}</span>
            <span>{status()!.openclawVersion ?? "\u2014"}</span>
          </div>
          <Show
            when={
              status()!.channelCount !== null &&
              status()!.channelCount !== undefined &&
              (status()!.channelCount ?? 0) >= 1
            }
          >
            <div class="kiloclaw-sidebar-detail">
              <span class="kiloclaw-sidebar-muted">{t("kiloClaw.sidebar.channels")}</span>
              <span>{status()!.channelCount}</span>
            </div>
          </Show>
        </div>
      </Show>

      <Show when={!status()}>
        <div class="kiloclaw-sidebar-section">
          <span class="kiloclaw-sidebar-muted">{t("kiloClaw.sidebar.noData")}</span>
        </div>
      </Show>
    </div>
  )
}
