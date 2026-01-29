import { Component, Show } from "solid-js"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { preferredProviders, useProviders } from "@/hooks/use-providers" // kilocode_change - renamed to preferredProviders
import { Dialog } from "@opencode-ai/ui/dialog"
import { List } from "@opencode-ai/ui/list"
import { Tag } from "@opencode-ai/ui/tag"
import { ProviderIcon } from "@opencode-ai/ui/provider-icon"
import { iconNames, type IconName } from "@opencode-ai/ui/icons/provider"
import { DialogConnectProvider } from "./dialog-connect-provider"
import { useLanguage } from "@/context/language"
import { DialogCustomProvider } from "./dialog-custom-provider"

const CUSTOM_ID = "_custom"

function icon(id: string): IconName {
  if (iconNames.includes(id as IconName)) return id as IconName
  return "synthetic"
}

export const DialogSelectProvider: Component = () => {
  const dialog = useDialog()
  const providers = useProviders()
  const language = useLanguage()

  // kilocode_change start - Use "Recommended" terminology to match kilocode
  const recommendedGroup = () => language.t("dialog.provider.group.recommended")
  const otherGroup = () => language.t("dialog.provider.group.other")
  // kilocode_change end

  return (
    <Dialog title={language.t("command.provider.connect")} transition>
      <List
        search={{ placeholder: language.t("dialog.provider.search.placeholder"), autofocus: true }}
        emptyMessage={language.t("dialog.provider.empty")}
        activeIcon="plus-small"
        key={(x) => x?.id}
        items={() => {
          language.locale()
          return [{ id: CUSTOM_ID, name: "Custom provider" }, ...providers.all()]
        }}
        filterKeys={["id", "name"]}
        groupBy={(x) => (preferredProviders.includes(x.id) ? recommendedGroup() : otherGroup())}
        sortBy={(a, b) => {
          if (a.id === CUSTOM_ID) return -1
          if (b.id === CUSTOM_ID) return 1
          if (preferredProviders.includes(a.id) && preferredProviders.includes(b.id))
            return preferredProviders.indexOf(a.id) - preferredProviders.indexOf(b.id)
          return a.name.localeCompare(b.name)
        }}
        sortGroupsBy={(a, b) => {
          const recommended = recommendedGroup()
          if (a.category === recommended && b.category !== recommended) return -1
          if (b.category === recommended && a.category !== recommended) return 1
          return 0
        }}
        onSelect={(x) => {
          if (!x) return
          if (x.id === CUSTOM_ID) {
            dialog.show(() => <DialogCustomProvider back="providers" />)
            return
          }
          dialog.show(() => <DialogConnectProvider provider={x.id} />)
        }}
      >
        {(i) => (
          <div class="px-1.25 w-full flex items-center gap-x-3">
            <ProviderIcon data-slot="list-item-extra-icon" id={icon(i.id)} />
            <span>{i.name}</span>
            <Show when={i.id === CUSTOM_ID}>
              <Tag>{language.t("settings.providers.tag.custom")}</Tag>
            </Show>
            {/* kilocode_change start - Provider tags and notes */}
            <Show when={i.id === "kilo"}>
              <Tag>{language.t("dialog.provider.tag.recommended")}</Tag>
              <div class="text-14-regular text-text-weak">{language.t("dialog.provider.kilo.note")}</div>
            </Show>
            {/* kilocode_change end */}
            <Show when={i.id === "opencode"}>
              <Tag>{language.t("dialog.provider.tag.recommended")}</Tag>
            </Show>
            <Show when={i.id === "anthropic"}>
              <div class="text-14-regular text-text-weak">{language.t("dialog.provider.anthropic.note")}</div>
            </Show>
            <Show when={i.id === "openai"}>
              <div class="text-14-regular text-text-weak">{language.t("dialog.provider.openai.note")}</div>
            </Show>
            <Show when={i.id.startsWith("github-copilot")}>
              <div class="text-14-regular text-text-weak">{language.t("dialog.provider.copilot.note")}</div>
            </Show>
          </div>
        )}
      </List>
    </Dialog>
  )
}
