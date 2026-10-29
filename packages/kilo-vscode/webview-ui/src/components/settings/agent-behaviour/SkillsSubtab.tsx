// The Skills subtab: the discovered skills list plus the skill folder paths and URLs. Discovered skills come from
// `api.skill.list` and are read-only (v2 has no removal endpoint). Folder paths and URLs both live in the config
// `skills` array, split here by URL for the two v1 lists.
import { Component, For, Show, createEffect, createSignal, on } from "solid-js"
import { Button } from "@kilocode/kilo-ui/button"
import { Card } from "@kilocode/kilo-ui/card"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { TextField } from "@kilocode/kilo-ui/text-field"
import { Tooltip } from "@kilocode/kilo-ui/tooltip"
import { useLanguage } from "../../../context/language"
import { useV2 } from "../../../v2/client"
import { useSettingsConfig } from "../../../v2/settings-config"

const isUrl = (value: string) => /^https?:\/\//i.test(value)

const SkillsSubtab: Component = () => {
  const language = useLanguage()
  const v2 = useV2()
  const config = useSettingsConfig()
  const [draftPath, setDraftPath] = createSignal("")
  const [draftUrl, setDraftUrl] = createSignal("")

  createEffect(
    on(v2.connection.status, (status) => {
      if (status === "connected") void v2.data.location.skill.sync().catch(v2.report)
    }),
  )

  // A skills path or URL change can change the discovered skills. The config resource does not invalidate the skill
  // resource, so re-sync when the config changes.
  createEffect(() => {
    config.value(["skills"])
    void v2.data.location.skill.sync().catch(v2.report)
  })

  const discovered = () => v2.data.location.skill.list() ?? []

  // The v2 key is one array. A v1-written file may still hold the legacy `{ paths, urls }` object.
  const skills = (): string[] => {
    const value = config.value(["skills"])
    if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string")
    if (value && typeof value === "object") {
      const legacy = value as { paths?: unknown; urls?: unknown }
      const list = (item: unknown) => (Array.isArray(item) ? item.filter((entry): entry is string => typeof entry === "string") : [])
      return [...list(legacy.paths), ...list(legacy.urls)]
    }
    return []
  }

  const paths = () => skills().filter((item) => !isUrl(item))
  const urls = () => skills().filter(isUrl)

  // Write to the file that already defines the key, so a project value is not shadowed by a global write.
  const scope = () => config.source(["skills"]) ?? "global"

  const write = (nextPaths: string[], nextUrls: string[]) => {
    const next = [...nextPaths, ...nextUrls]
    if (next.length === 0) config.unset(["skills"], scope())
    else config.set(["skills"], next, scope())
  }

  const addPath = () => {
    const value = draftPath().trim()
    if (!value) return
    if (!paths().includes(value)) write([...paths(), value], urls())
    setDraftPath("")
  }

  const addUrl = () => {
    const value = draftUrl().trim()
    if (!value) return
    if (!urls().includes(value)) write(paths(), [...urls(), value])
    setDraftUrl("")
  }

  const entryRow = (value: string, remove: () => void) => (
    <div
      style={{
        display: "flex",
        "align-items": "center",
        "justify-content": "space-between",
        padding: "6px 0",
        gap: "8px",
      }}
    >
      <Tooltip value={value} class="settings-skills-row-trigger" contentClass="settings-skills-tooltip-content">
        <span
          style={{
            width: "100%",
            "font-family": "var(--vscode-editor-font-family, monospace)",
            "font-size": "var(--kilo-font-size-12)",
            overflow: "hidden",
            "text-overflow": "ellipsis",
            "white-space": "nowrap",
          }}
        >
          {value}
        </span>
      </Tooltip>
      <IconButton size="small" variant="ghost" icon="close" onClick={remove} />
    </div>
  )

  return (
    <div>
      {/* Discovered skills */}
      <h4 style={{ "margin-top": "0", "margin-bottom": "8px" }}>
        {language.t("settings.agentBehaviour.discoveredSkills")}
      </h4>
      <Show
        when={discovered().length > 0}
        fallback={
          <Card style={{ "margin-bottom": "16px" }}>
            <div data-slot="settings-row-label-subtitle">{language.t("settings.agentBehaviour.noSkillsFound")}</div>
          </Card>
        }
      >
        <Card style={{ "margin-bottom": "16px" }}>
          <For each={discovered()}>
            {(skill, index) => (
              <div
                style={{
                  display: "flex",
                  "align-items": "center",
                  "justify-content": "space-between",
                  padding: "8px 0",
                  "border-bottom": index() < discovered().length - 1 ? "1px solid var(--border-weak-base)" : "none",
                }}
              >
                <div style={{ flex: 1, "min-width": 0 }}>
                  <div data-slot="settings-row-label-title" style={{ "margin-bottom": "0" }}>
                    {skill.name}
                  </div>
                  <div
                    data-slot="settings-row-label-subtitle"
                    style={{ "margin-top": "4px", "font-family": "var(--vscode-editor-font-family, monospace)" }}
                  >
                    <Show when={skill.description}>
                      <div>{skill.description}</div>
                    </Show>
                    <div>{skill.path}</div>
                  </div>
                </div>
              </div>
            )}
          </For>
        </Card>
      </Show>

      {/* Skill paths */}
      <h4 style={{ "margin-top": "0", "margin-bottom": "8px" }}>{language.t("settings.agentBehaviour.skillPaths")}</h4>
      <Card style={{ "margin-bottom": "16px" }}>
        <div
          style={{
            display: "flex",
            gap: "8px",
            "align-items": "center",
            padding: "8px 0",
            "border-bottom": paths().length > 0 || draftPath() ? "1px solid var(--border-weak-base)" : "none",
          }}
        >
          <div style={{ flex: 1, "min-width": 0 }}>
            <TextField
              value={draftPath()}
              placeholder="e.g. ./skills"
              onChange={(val) => setDraftPath(val)}
              onKeyDown={(e: KeyboardEvent) => {
                if (e.key === "Enter") addPath()
              }}
            />
          </div>
          <Button variant="secondary" onClick={addPath}>
            {language.t("common.add")}
          </Button>
        </div>
        <For each={paths()}>
          {(path, index) => (
            <div
              style={{
                "border-bottom": index() < paths().length - 1 ? "1px solid var(--border-weak-base)" : "none",
              }}
            >
              {entryRow(path, () => write(paths().filter((_, item) => item !== index()), urls()))}
            </div>
          )}
        </For>
      </Card>

      {/* Skill URLs */}
      <h4 style={{ "margin-top": "0", "margin-bottom": "8px" }}>{language.t("settings.agentBehaviour.skillUrls")}</h4>
      <Card>
        <div
          style={{
            display: "flex",
            gap: "8px",
            "align-items": "center",
            padding: "8px 0",
            "border-bottom": urls().length > 0 || draftUrl() ? "1px solid var(--border-weak-base)" : "none",
          }}
        >
          <div style={{ flex: 1, "min-width": 0 }}>
            <TextField
              value={draftUrl()}
              placeholder="e.g. https://example.com/skills"
              onChange={(val) => setDraftUrl(val)}
              onKeyDown={(e: KeyboardEvent) => {
                if (e.key === "Enter") addUrl()
              }}
            />
          </div>
          <Button variant="secondary" onClick={addUrl}>
            {language.t("common.add")}
          </Button>
        </div>
        <For each={urls()}>
          {(url, index) => (
            <div
              style={{
                "border-bottom": index() < urls().length - 1 ? "1px solid var(--border-weak-base)" : "none",
              }}
            >
              {entryRow(url, () => write(paths(), urls().filter((_, item) => item !== index())))}
            </div>
          )}
        </For>
      </Card>
    </div>
  )
}

export default SkillsSubtab
