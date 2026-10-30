import { Component, For, Show, createEffect, createMemo, createSignal } from "solid-js"
import { Select } from "@kilocode/kilo-ui/select"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { Icon } from "@kilocode/kilo-ui/icon"

import { useLanguage } from "../../context/language"
import { useSettingsConfig } from "../../v2/settings-config"
import type { PermissionLevel, PermissionRuleset } from "./permission-utils"
import {
  DEFAULT_RULES,
  addExceptionLevel,
  clearGroupedLevel,
  clearSimpleLevel,
  clearWildcardLevel,
  effectiveConfigLevel,
  inheritedTool,
  mostRestrictive,
  removeExceptionLevel,
  setExceptionLevel,
  setGroupedLevel,
  setSimpleLevel,
  setWildcardLevel,
  toolExceptions,
} from "./permission-utils"

export type PermissionTarget = { kind: "root" } | { kind: "agent"; name: string }

export interface PermissionEditorProps {
  target: PermissionTarget
}

type LevelValue = PermissionLevel | "inherit"

interface LevelOption {
  value: LevelValue
  labelKey: string
}

const LEVEL_OPTIONS: LevelOption[] = [
  { value: "allow", labelKey: "settings.autoApprove.level.allow" },
  { value: "ask", labelKey: "settings.autoApprove.level.ask" },
  { value: "deny", labelKey: "settings.autoApprove.level.deny" },
]

const INHERIT_OPTION: LevelOption = { value: "inherit", labelKey: "common.default" }

interface GranularConfig {
  wildcardKey: string
  addKey: string
  placeholderKey: string
}

interface ToolDef {
  action: string
  title: string
  descriptionKey: string
  granular?: GranularConfig
}

interface GranularToolDef extends ToolDef {
  granular: GranularConfig
}

interface GroupedToolDef {
  actions: string[]
  title: string
  descriptionKey: string
}

const GRANULAR_TOOLS: GranularToolDef[] = [
  {
    action: "external_directory",
    title: "External Directory",
    descriptionKey: "settings.autoApprove.tool.external_directory",
    granular: {
      wildcardKey: "settings.autoApprove.wildcardLabel.paths",
      addKey: "settings.autoApprove.addPath",
      placeholderKey: "settings.autoApprove.placeholder.path",
    },
  },
  {
    action: "shell",
    title: "Bash",
    descriptionKey: "settings.autoApprove.tool.bash",
    granular: {
      wildcardKey: "settings.autoApprove.wildcardLabel.commands",
      addKey: "settings.autoApprove.addCommand",
      placeholderKey: "settings.autoApprove.placeholder.command",
    },
  },
  {
    action: "read",
    title: "Read",
    descriptionKey: "settings.autoApprove.tool.read",
    granular: {
      wildcardKey: "settings.autoApprove.wildcardLabel.paths",
      addKey: "settings.autoApprove.addPath",
      placeholderKey: "settings.autoApprove.placeholder.path",
    },
  },
  {
    action: "edit",
    title: "Edit",
    descriptionKey: "settings.autoApprove.tool.edit",
    granular: {
      wildcardKey: "settings.autoApprove.wildcardLabel.paths",
      addKey: "settings.autoApprove.addPath",
      placeholderKey: "settings.autoApprove.placeholder.path",
    },
  },
]

// The tools with a single level. The action set has no list or lsp tool. The renamed actions keep the
// familiar titles: shell shows Bash and subagent shows Task.
const SIMPLE_TOOLS: ToolDef[] = [
  { action: "glob", title: "Glob", descriptionKey: "settings.autoApprove.tool.glob" },
  { action: "grep", title: "Grep", descriptionKey: "settings.autoApprove.tool.grep" },
  { action: "subagent", title: "Task", descriptionKey: "settings.autoApprove.tool.task" },
  { action: "skill", title: "Skill", descriptionKey: "settings.autoApprove.tool.skill" },
]

// Only todowrite groups the todo action.
const GROUPED_TOOLS: GroupedToolDef[] = [
  {
    actions: ["todowrite"],
    title: "Todowrite",
    descriptionKey: "settings.autoApprove.tool.todoreadwrite",
  },
]

// There is no browser_open or doom_loop action. These rows have no exception editor, so changing a level replaces
// every rule for the action, including any per-resource rules the user added elsewhere.
const TRAILING_TOOLS: ToolDef[] = [
  { action: "websearch", title: "Websearch", descriptionKey: "settings.autoApprove.tool.websearch" },
  { action: "webfetch", title: "Webfetch", descriptionKey: "settings.autoApprove.tool.webfetch" },
]

/** Controlled editor over a ruleset. The v2 config layer is in the default export below. */
export const PermissionRulesEditor: Component<{
  rules: PermissionRuleset
  defaults?: PermissionRuleset
  description?: string
  component?: string
  inherited?: boolean
  showDefaultLevel?: boolean
  onChange: (next: PermissionRuleset) => void
}> = (props) => {
  const levelFor = (action: string): PermissionLevel => effectiveConfigLevel(props.rules, action, props.defaults)
  const ruleInherited = (action: string) => props.inherited && inheritedTool(props.rules, action)
  const setWildcard = (action: string, level: PermissionLevel) =>
    props.onChange(setWildcardLevel(props.rules, action, level))
  const clearWildcard = (action: string) => props.onChange(clearWildcardLevel(props.rules, action))
  const setSimple = (action: string, level: PermissionLevel) =>
    props.onChange(setSimpleLevel(props.rules, action, level))
  const clearSimple = (action: string) => props.onChange(clearSimpleLevel(props.rules, action))
  const setGrouped = (actions: string[], level: PermissionLevel) =>
    props.onChange(setGroupedLevel(props.rules, actions, level))
  const clearGrouped = (actions: string[]) => props.onChange(clearGroupedLevel(props.rules, actions))
  const setException = (action: string, resource: string, level: PermissionLevel) =>
    props.onChange(setExceptionLevel(props.rules, action, resource, level))
  const addException = (action: string, resource: string) =>
    props.onChange(addExceptionLevel(props.rules, action, resource))
  const removeException = (action: string, resource: string) =>
    props.onChange(removeExceptionLevel(props.rules, action, resource))

  return (
    <div data-component={props.component ?? "auto-approve-settings"}>
      <Show when={props.description}>
        <div
          style={{
            "font-size": "var(--kilo-font-size-12)",
            color: "var(--text-weak-base, var(--vscode-descriptionForeground))",
            "padding-bottom": "12px",
            "border-bottom": "1px solid var(--border-weak-base)",
          }}
        >
          {props.description}
        </div>
      </Show>

      <For each={GRANULAR_TOOLS}>
        {(tool) => (
          <GranularToolRow
            tool={tool}
            exceptions={toolExceptions(props.rules, tool.action)}
            fallback={levelFor(tool.action)}
            inherited={ruleInherited(tool.action)}
            allowInherit={props.inherited}
            showDefaultLevel={props.showDefaultLevel}
            onWildcardChange={(level) => setWildcard(tool.action, level)}
            onWildcardInherit={() => clearWildcard(tool.action)}
            onExceptionChange={(resource, level) => setException(tool.action, resource, level)}
            onExceptionAdd={(resource) => addException(tool.action, resource)}
            onExceptionRemove={(resource) => removeException(tool.action, resource)}
          />
        )}
      </For>

      <For each={SIMPLE_TOOLS}>
        {(tool) => (
          <SimpleToolRow
            title={tool.title}
            descriptionKey={tool.descriptionKey}
            level={levelFor(tool.action)}
            inherited={ruleInherited(tool.action)}
            showDefaultLevel={props.showDefaultLevel}
            onChange={(level) => setSimple(tool.action, level)}
            onInherit={() => clearSimple(tool.action)}
          />
        )}
      </For>

      <For each={GROUPED_TOOLS}>
        {(group) => (
          <SimpleToolRow
            title={group.title}
            descriptionKey={group.descriptionKey}
            level={mostRestrictive(group.actions.map(levelFor))}
            inherited={props.inherited && group.actions.every((action) => inheritedTool(props.rules, action))}
            showDefaultLevel={props.showDefaultLevel}
            onChange={(level) => setGrouped(group.actions, level)}
            onInherit={() => clearGrouped(group.actions)}
          />
        )}
      </For>

      <For each={TRAILING_TOOLS}>
        {(tool) => (
          <SimpleToolRow
            title={tool.title}
            descriptionKey={tool.descriptionKey}
            level={levelFor(tool.action)}
            inherited={ruleInherited(tool.action)}
            showDefaultLevel={props.showDefaultLevel}
            onChange={(level) => setSimple(tool.action, level)}
            onInherit={() => clearSimple(tool.action)}
          />
        )}
      </For>
    </div>
  )
}

const SimpleToolRow: Component<{
  title: string
  descriptionKey: string
  level: PermissionLevel
  inherited?: boolean
  showDefaultLevel?: boolean
  onChange: (level: PermissionLevel) => void
  onInherit?: () => void
}> = (props) => {
  const language = useLanguage()
  return (
    <div
      style={{
        display: "flex",
        gap: "24px",
        "align-items": "flex-start",
        "justify-content": "space-between",
        padding: "12px 0",
        "border-bottom": "1px solid var(--border-weak-base)",
      }}
    >
      <div style={{ flex: 1, "min-width": 0 }}>
        <div style={{ "font-size": "var(--kilo-font-size-13)", color: "var(--text-base, var(--vscode-foreground))" }}>
          {props.title}
        </div>
        <div
          style={{
            "font-size": "var(--kilo-font-size-12)",
            color: "var(--text-weak-base, var(--vscode-descriptionForeground))",
            "margin-top": "6px",
          }}
        >
          {language.t(props.descriptionKey)}
        </div>
      </div>
      <ActionSelect
        level={props.level}
        inherited={props.inherited}
        showDefaultLevel={props.showDefaultLevel}
        onChange={props.onChange}
        onInherit={props.onInherit}
      />
    </div>
  )
}

const GranularToolRow: Component<{
  tool: GranularToolDef
  exceptions: PermissionRuleset
  fallback: PermissionLevel
  inherited?: boolean
  allowInherit?: boolean
  showDefaultLevel?: boolean
  onWildcardChange: (level: PermissionLevel) => void
  onWildcardInherit: () => void
  onExceptionChange: (resource: string, level: PermissionLevel) => void
  onExceptionAdd: (resource: string) => void
  onExceptionRemove: (resource: string) => void
}> = (props) => {
  const language = useLanguage()
  const [adding, setAdding] = createSignal(false)
  const [input, setInput] = createSignal("")
  const [override, setOverride] = createSignal<boolean | null>(null)
  let ref: HTMLInputElement | undefined

  createEffect(() => {
    if (adding()) ref?.focus()
  })

  const expanded = createMemo(() => override() ?? props.exceptions.length <= 5)
  const toggle = () => setOverride(!expanded())
  const submit = () => {
    const val = input().trim()
    if (val) {
      props.onExceptionAdd(val)
      setInput("")
    }
    setAdding(false)
  }
  const cancel = () => {
    setInput("")
    setAdding(false)
  }

  return (
    <div style={{ padding: "12px 0", "border-bottom": "1px solid var(--border-weak-base)" }}>
      <div style={{ display: "flex", gap: "24px", "align-items": "flex-start", "justify-content": "space-between" }}>
        <div style={{ flex: 1, "min-width": 0 }}>
          <div style={{ "font-size": "var(--kilo-font-size-13)", color: "var(--text-base, var(--vscode-foreground))" }}>
            {props.tool.title}
          </div>
          <div
            style={{
              "font-size": "var(--kilo-font-size-12)",
              color: "var(--text-weak-base, var(--vscode-descriptionForeground))",
              "margin-top": "6px",
            }}
          >
            {language.t(props.tool.descriptionKey)}
          </div>
        </div>
      </div>

      <div
        style={{
          display: "flex",
          gap: "24px",
          "align-items": "center",
          "justify-content": "space-between",
          padding: "8px 0",
        }}
      >
        <div style={{ flex: 1, "min-width": 0 }}>
          <div style={{ "font-size": "var(--kilo-font-size-12)", color: "var(--text-base, #ccc)" }}>
            {language.t(props.tool.granular.wildcardKey)}
          </div>
        </div>
        <ActionSelect
          level={props.fallback}
          inherited={props.inherited}
          showDefaultLevel={props.showDefaultLevel}
          onChange={props.onWildcardChange}
          onInherit={props.allowInherit ? props.onWildcardInherit : undefined}
        />
      </div>

      <Show when={props.exceptions.length > 0}>
        <div style={{ "margin-top": "4px" }}>
          <button
            type="button"
            onClick={toggle}
            style={{
              display: "flex",
              "align-items": "center",
              gap: "4px",
              padding: "0",
              background: "none",
              border: "none",
              cursor: "pointer",
              "font-size": "var(--kilo-font-size-12)",
              color: "var(--text-weak-base, var(--vscode-descriptionForeground))",
              "margin-bottom": "4px",
              "font-family": "inherit",
            }}
            aria-expanded={expanded()}
          >
            <span
              style={{
                display: "inline-flex",
                "align-items": "center",
                transition: "transform 0.15s ease",
                transform: expanded() ? "rotate(90deg)" : "rotate(0deg)",
              }}
            >
              <Icon name="chevron-right" size="small" />
            </span>
            <span>
              {language.t("settings.autoApprove.exceptions")} ({props.exceptions.length})
            </span>
          </button>
          <Show when={expanded()}>
            <For each={props.exceptions}>
              {(exc) => (
                <div
                  style={{
                    display: "flex",
                    gap: "8px",
                    "align-items": "center",
                    padding: "4px 0",
                    "padding-left": "12px",
                    "border-top": "1px solid var(--border-weak-base)",
                  }}
                >
                  <div
                    style={{
                      flex: "1 1 0%",
                      "min-width": 0,
                      "font-size": "var(--kilo-font-size-13)",
                      "font-family": "var(--vscode-editor-font-family, monospace)",
                      color: "var(--text-base, #ccc)",
                      overflow: "hidden",
                      "text-overflow": "ellipsis",
                      "white-space": "nowrap",
                    }}
                    title={exc.resource}
                  >
                    {exc.resource}
                  </div>
                  <div style={{ display: "flex", gap: "4px", "align-items": "center", "flex-shrink": 0 }}>
                    <ActionSelect
                      level={exc.effect}
                      onChange={(level: PermissionLevel) => props.onExceptionChange(exc.resource, level)}
                    />
                    <IconButton
                      variant="ghost"
                      size="small"
                      icon="close"
                      onClick={() => props.onExceptionRemove(exc.resource)}
                    />
                  </div>
                </div>
              )}
            </For>
          </Show>
        </div>
      </Show>

      <Show
        when={adding()}
        fallback={
          <button
            style={{
              display: "flex",
              gap: "4px",
              "align-items": "center",
              padding: "4px 0",
              background: "none",
              border: "none",
              cursor: "pointer",
              "font-size": "var(--kilo-font-size-12)",
              color: "var(--text-link-base, #3794ff)",
              "font-family": "inherit",
              "margin-top": "4px",
            }}
            onClick={() => setAdding(true)}
          >
            <span style={{ "font-size": "var(--kilo-font-size-14)" }}>+</span>
            {language.t(props.tool.granular.addKey)}
          </button>
        }
      >
        <div style={{ display: "flex", gap: "8px", "align-items": "center", "margin-top": "4px" }}>
          <input
            ref={(el) => (ref = el)}
            type="text"
            value={input()}
            onInput={(e) => setInput(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit()
              if (e.key === "Escape") cancel()
            }}
            onBlur={() => {
              if (!input().trim()) cancel()
            }}
            placeholder={language.t(props.tool.granular.placeholderKey)}
            style={{
              flex: 1,
              "min-width": 0,
              background: "var(--surface-strong-base, #252526)",
              border: "1px solid var(--border-base, #434443)",
              "border-radius": "2px",
              color: "var(--text-base, #ccc)",
              "font-size": "var(--kilo-font-size-13)",
              "font-family": "var(--vscode-editor-font-family, monospace)",
              padding: "4px 8px",
              outline: "none",
            }}
          />
          <IconButton variant="ghost" size="small" icon="close" onClick={cancel} />
        </div>
      </Show>
    </div>
  )
}

const ActionSelect: Component<{
  level: PermissionLevel
  inherited?: boolean
  showDefaultLevel?: boolean
  onChange: (level: PermissionLevel) => void
  onInherit?: () => void
}> = (props) => {
  const language = useLanguage()
  const opts = createMemo(() => (props.onInherit ? [INHERIT_OPTION, ...LEVEL_OPTIONS] : LEVEL_OPTIONS))
  const label = (option: LevelOption) => {
    if (option.value !== "inherit" || !props.showDefaultLevel) return language.t(option.labelKey)
    const level = LEVEL_OPTIONS.find((item) => item.value === props.level)!
    return `${language.t(option.labelKey)} (${language.t(level.labelKey)})`
  }
  return (
    <Select
      options={opts()}
      current={props.inherited ? INHERIT_OPTION : LEVEL_OPTIONS.find((option) => option.value === props.level)}
      value={(option) => option.value}
      label={label}
      onSelect={(option) => {
        if (!option) return
        if (option.value === "inherit") {
          props.onInherit?.()
          return
        }
        props.onChange(option.value)
      }}
      variant="secondary"
      size="small"
      triggerVariant="settings"
    />
  )
}

// Read the stored ruleset, keeping only well-formed rules so a hand-edited config cannot break the editor.
function readRules(value: unknown): PermissionRuleset {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (typeof item !== "object" || item === null) return []
    const rule = item as { action?: unknown; resource?: unknown; effect?: unknown }
    if (typeof rule.action !== "string" || typeof rule.resource !== "string") return []
    if (rule.effect !== "allow" && rule.effect !== "ask" && rule.effect !== "deny") return []
    return [{ action: rule.action, resource: rule.resource, effect: rule.effect }]
  })
}

const PermissionEditor: Component<PermissionEditorProps> = (props) => {
  const config = useSettingsConfig()
  const language = useLanguage()
  const path = createMemo(() =>
    props.target.kind === "root" ? ["permissions"] : ["agents", props.target.name, "permissions"],
  )
  const rules = createMemo(() => readRules(config.value(path())))
  // Write back to the file that already defines the value, so a project value is not shadowed by a global write.
  const scope = () => config.source(path()) ?? "global"
  const onChange = (next: PermissionRuleset) => {
    if (next.length > 0) config.set(path(), next, scope())
    else config.unset(path(), scope())
  }

  return (
    <PermissionRulesEditor
      component={props.target.kind === "root" ? "auto-approve-settings" : "agent-permission-settings"}
      rules={rules()}
      defaults={DEFAULT_RULES}
      description={props.target.kind === "root" ? language.t("settings.autoApprove.description") : undefined}
      inherited
      showDefaultLevel={props.target.kind === "root"}
      onChange={onChange}
    />
  )
}

export default PermissionEditor
