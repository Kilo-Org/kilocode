import { Show, createSignal, onMount, type JSX } from "solid-js"
import { Button } from "@kilocode/kilo-ui/button"
import { Card } from "@kilocode/kilo-ui/card"
import { Tag } from "@kilocode/kilo-ui/tag"
import { useLanguage } from "../../context/language"
import type {
  MarketplaceItem,
  MarketplaceRecord,
  MarketplaceScope,
} from "../../v2/marketplace-data"
import type { createMcp } from "../../v2/mcp"
import { kindLabel, needsRepair, recordsFor, statusLabel } from "./utils"

interface Props {
  item?: MarketplaceItem
  record?: MarketplaceRecord
  records: readonly MarketplaceRecord[]
  mcp: ReturnType<typeof createMcp>
  onInstall: (item: MarketplaceItem, scope?: MarketplaceScope) => void
  onRemove: (record: MarketplaceRecord) => void
  onRepair: (item: MarketplaceItem, record: MarketplaceRecord) => void
  onSignIn: (server: string) => void
  onOpen: (url: string) => void
  footer?: JSX.Element
}

export const ItemCard = (props: Props) => {
  const language = useLanguage()
  const records = () => (props.item ? recordsFor(props.records, props.item) : props.record ? [props.record] : [])
  const kind = () => props.item?.kind ?? props.record?.kind ?? "skill"
  const name = () => props.item?.name ?? props.record?.id ?? ""
  const registry = () => props.item?.registry ?? props.record?.registry
  const description = () => props.item?.description
  const [expanded, setExpanded] = createSignal(false)
  const [clamped, setClamped] = createSignal(false)
  let ref: HTMLParagraphElement | undefined

  onMount(() => {
    if (ref && ref.scrollHeight > ref.clientHeight) setClamped(true)
  })

  const openLink = (url: string) => props.onOpen(url)
  const serverStatus = (record: MarketplaceRecord) =>
    record.server ? props.mcp.status(record.server) : undefined
  const signInBusy = (record: MarketplaceRecord) =>
    record.server ? props.mcp.busy().includes(record.server) : false

  return (
    <Card class="marketplace-card">
      <div class="marketplace-card-header">
        <div class="marketplace-card-title">
          <Show when={props.item?.url} fallback={<span class="marketplace-card-name">{name()}</span>}>
            <span class="marketplace-card-name clickable" onClick={() => openLink(props.item!.url!)}>
              {name()}
            </span>
          </Show>
          <Tag class={`marketplace-badge-type marketplace-type-${kind()}`}>{kindLabel(language.t, kind())}</Tag>
        </div>
        <Show when={props.item?.author}>
          <span class="marketplace-card-author">{language.t("marketplace.card.by", { author: props.item!.author! })}</span>
        </Show>
        <Show when={registry()}>
          <span class="marketplace-card-author">{registry()}</span>
        </Show>
      </div>
      <Show when={description()}>
        <p ref={ref} class="marketplace-card-description" classList={{ expanded: expanded() }}>
          {description()}
        </p>
      </Show>
      <Show when={clamped()}>
        <button class="marketplace-card-expand" onClick={() => setExpanded(!expanded())}>
          {expanded() ? language.t("marketplace.card.showLess") : language.t("marketplace.card.showMore")}
        </button>
      </Show>

      <Show when={records().length === 0 && props.item}>
        <div class="marketplace-card-records">
          <div class="marketplace-record-row">
            <div class="marketplace-card-tags" />
            <div class="marketplace-card-actions">
              <Button size="small" onClick={() => props.onInstall(props.item!, undefined)}>
                {language.t("marketplace.card.install")}
              </Button>
            </div>
          </div>
        </div>
      </Show>

      <Show when={records().length > 0}>
        <div class="marketplace-card-records">
          {records().map((record) => (
            <div class="marketplace-record" data-marketplace-record={[record.registry, record.kind, record.id, record.scope].join(":")}>
              <div class="marketplace-record-head">
                <div class="marketplace-card-tags">
                  <Tag class="marketplace-badge-installed">{language.t("marketplace.card.installed")}</Tag>
                  <Tag>{language.t(`marketplace.scope.${record.scope}`)}</Tag>
                  <Show when={needsRepair(record)}>
                    <Tag class="marketplace-status-warning">{statusLabel(language.t, record)}</Tag>
                  </Show>
                  <Show when={record.kind === "mcp" && serverStatus(record)?.status === "needs_auth"}>
                    <Tag class="marketplace-status-warning">{language.t("mcp.status.needs_auth")}</Tag>
                  </Show>
                </div>
                <div class="marketplace-card-actions">
                  <Show when={props.item}>
                    <Button size="small" variant="ghost" onClick={() => props.onRepair(props.item!, record)}>
                      {needsRepair(record)
                        ? language.t("marketplace.card.repair")
                        : language.t("marketplace.card.reinstall")}
                    </Button>
                  </Show>
                  <Show when={record.kind === "mcp" && serverStatus(record)?.status === "needs_auth" && record.server}>
                    <Show
                      when={signInBusy(record)}
                      fallback={
                        <Button size="small" onClick={() => props.onSignIn(record.server!)}>
                          {language.t("marketplace.install.mcp.signIn.button")}
                        </Button>
                      }
                    >
                      <Button size="small" variant="ghost" onClick={() => props.mcp.cancel(record.server!)}>
                        {language.t("marketplace.install.mcp.signIn.cancel")}
                      </Button>
                    </Show>
                  </Show>
                  <Button
                    size="small"
                    variant="ghost"
                    class="marketplace-remove-btn"
                    onClick={() => props.onRemove(record)}
                  >
                    {records().length > 1
                      ? language.t("marketplace.card.removeScope", {
                          scope: language.t(`marketplace.scope.${record.scope}`),
                        })
                      : language.t("marketplace.card.remove")}
                  </Button>
                </div>
              </div>
              <Show when={record.status === "modified"}>
                <p class="marketplace-record-note">{language.t("marketplace.card.modified")}</p>
              </Show>
              <Show when={record.warnings?.length}>
                <ul class="marketplace-record-warnings">
                  {record.warnings!.map((warning) => (
                    <li>{warning}</li>
                  ))}
                </ul>
              </Show>
            </div>
          ))}
        </div>
      </Show>
      <Show when={props.footer}>
        <div class="marketplace-card-footer">
          <div class="marketplace-card-tags">{props.footer}</div>
        </div>
      </Show>
    </Card>
  )
}
