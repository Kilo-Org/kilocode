import { Component, For, Show, createEffect, createMemo, createSignal } from "solid-js"
import { Select } from "@kilocode/kilo-ui/select"
import { IconButton } from "@kilocode/kilo-ui/icon-button"

import { useLanguage } from "../../context/language"
import type { PermissionConfig, PermissionLevel, PermissionRule, PermissionRuleItem } from "../../types/messages"
import {
  addExceptionPatch,
  clearGroupedPatch,
  clearWildcardPatch,
  effectiveRuleLevel,
  inheritedWildcard,
  mostRestrictive,
  permissionExceptions,
  removeExceptionPatch,
  setExceptionPatch,
  setGroupedPatch,
  setWildcardPatch,
  wildcardAction,
  type PermissionPatch,
} from "./permission-utils"

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
  id: string
  descriptionKey: string
  granular?: GranularConfig
}

interface GranularToolDef extends ToolDef {
  granular: GranularConfig
}

interface GroupedToolDef {
  ids: string[]
  label: string
  descriptionKey: string
}

const GRANULAR_TOOLS: GranularToolDef[] = [
  {
    id: "external_directory",
    descriptionKey: "settings.autoApprove.tool.external_directory",
    granular: {
      wildcardKey: "settings.autoApprove.wildcardLabel.paths",
      addKey: "settings.autoApprove.addPath",
      placeholderKey: "settings.autoApprove.placeholder.path",
    },
  },
  {
    id: "bash",
    descriptionKey: "settings.autoApprove.tool.bash",
    granular: {
      wildcardKey: "settings.autoApprove.wildcardLabel.commands",
      addKey: "settings.autoApprove.addCommand",
      placeholderKey: "settings.autoApprove.placeholder.command",
    },
  },
  {
    id: "read",
    descriptionKey: "settings.autoApprove.tool.read",
    granular: {
      wildcardKey: "settings.autoApprove.wildcardLabel.paths",
      addKey: "settings.autoApprove.addPath",
      placeholderKey: "settings.autoApprove.placeholder.path",
    },
  },
  {
    id: "edit",
    descriptionKey: "settings.autoApprove.tool.edit",
    granular: {
      wildcardKey: "settings.autoApprove.wildcardLabel.paths",
      addKey: "settings.autoApprove.addPath",
      placeholderKey: "settings.autoApprove.placeholder.path",
    },
  },
]

const SIMPLE_TOOLS: ToolDef[] = [
  { id: "glob", descriptionKey: "settings.autoApprove.tool.glob" },
  { id: "grep", descriptionKey: "settings.autoApprove.tool.grep" },
  { id: "list", descriptionKey: "settings.autoApprove.tool.list" },
  { id: "task", descriptionKey: "settings.autoApprove.tool.task" },
  { id: "skill", descriptionKey: "settings.autoApprove.tool.skill" },
  { id: "lsp", descriptionKey: "settings.autoApprove.tool.lsp" },
]

const GROUPED_TOOLS: GroupedToolDef[] = [
  {
    ids: ["todoread", "todowrite"],
    label: "todoread / todowrite",
    descriptionKey: "settings.autoApprove.tool.todoreadwrite",
  },
  {
    ids: ["websearch", "codesearch"],
    label: "websearch / codesearch",
    descriptionKey: "settings.autoApprove.tool.websearchcodesearch",
  },
]

const TRAILING_TOOLS: ToolDef[] = [
  { id: "webfetch", descriptionKey: "settings.autoApprove.tool.webfetch" },
  { id: "doom_loop", descriptionKey: "settings.autoApprove.tool.doom_loop" },
]

function toolTitle(id: string): string {
  return id
    .split("_")
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(" ")
    .split(" / ")
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(" / ")
}

const PermissionEditor: Component<{
  permissions?: PermissionConfig
  rules?: PermissionRuleItem[]
  description?: string
  component?: string
  inherited?: boolean
  onChange: (patch: PermissionPatch) => void
}> = (props) => {
  const perms = createMemo(() => props.permissions ?? {})

  const levelFor = (tool: string): PermissionLevel =>
    wildcardAction(perms()[tool], effectiveRuleLevel(props.rules, tool))

  const ruleFor = (tool: string): PermissionRule | undefined => perms()[tool]

  const setSimple = (tool: string, level: PermissionLevel) => {
    props.onChange({ [tool]: level })
  }

  const clearSimple = (tool: string) => {
    props.onChange({ [tool]: null })
  }

  const setGrouped = (ids: string[], level: PermissionLevel) => {
    props.onChange(setGroupedPatch(ids, level))
  }

  const clearGrouped = (ids: string[]) => {
    props.onChange(clearGroupedPatch(ids))
  }

  const setWildcard = (tool: string, level: PermissionLevel) => {
    props.onChange(setWildcardPatch(ruleFor(tool), tool, level))
  }

  const clearWildcard = (tool: string) => {
    props.onChange(clearWildcardPatch(ruleFor(tool), tool))
  }

  const setException = (tool: string, pattern: string, level: PermissionLevel) => {
    props.onChange(setExceptionPatch(ruleFor(tool), tool, pattern, level))
  }

  const addException = (tool: string, pattern: string) => {
    props.onChange(addExceptionPatch(ruleFor(tool), tool, pattern))
  }

  const removeException = (tool: string, pattern: string) => {
    const patch = removeExceptionPatch(ruleFor(tool), tool, pattern)
    if (patch) props.onChange(patch)
  }

  return (
    <div data-component={props.component ?? "auto-approve-settings"}>
      <Show when={props.description}>
        <div
          style={{
            "font-size": "12px",
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
            rule={ruleFor(tool.id)}
            fallback={levelFor(tool.id)}
            inherited={props.inherited && inheritedWildcard(ruleFor(tool.id))}
            allowInherit={props.inherited}
            onWildcardChange={(level) => setWildcard(tool.id, level)}
            onWildcardInherit={() => clearWildcard(tool.id)}
            onExceptionChange={(pattern, level) => setException(tool.id, pattern, level)}
            onExceptionAdd={(pattern) => addException(tool.id, pattern)}
            onExceptionRemove={(pattern) => removeException(tool.id, pattern)}
          />
        )}
      </For>

      <For each={SIMPLE_TOOLS}>
        {(tool) => (
          <SimpleToolRow
            id={tool.id}
            descriptionKey={tool.descriptionKey}
            level={levelFor(tool.id)}
            inherited={props.inherited && ruleFor(tool.id) === undefined}
            onChange={(level) => setSimple(tool.id, level)}
            onInherit={() => clearSimple(tool.id)}
          />
        )}
      </For>

      <For each={GROUPED_TOOLS}>
        {(group) => (
          <SimpleToolRow
            id={group.label}
            descriptionKey={group.descriptionKey}
            level={mostRestrictive(group.ids.map(levelFor))}
            inherited={props.inherited && group.ids.every((id) => ruleFor(id) === undefined)}
            onChange={(level) => setGrouped(group.ids, level)}
            onInherit={() => clearGrouped(group.ids)}
          />
        )}
      </For>

      <For each={TRAILING_TOOLS}>
        {(tool) => (
          <SimpleToolRow
            id={tool.id}
            descriptionKey={tool.descriptionKey}
            level={levelFor(tool.id)}
            inherited={props.inherited && ruleFor(tool.id) === undefined}
            onChange={(level) => setSimple(tool.id, level)}
            onInherit={() => clearSimple(tool.id)}
          />
        )}
      </For>
    </div>
  )
}

const SimpleToolRow: Component<{
  id: string
  descriptionKey: string
  level: PermissionLevel
  inherited?: boolean
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
        <div style={{ "font-size": "13px", color: "var(--text-base, var(--vscode-foreground))" }}>
          {toolTitle(props.id)}
        </div>
        <div
          style={{
            "font-size": "12px",
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
        onChange={props.onChange}
        onInherit={props.onInherit}
      />
    </div>
  )
}

const GranularToolRow: Component<{
  tool: GranularToolDef
  rule: PermissionRule | undefined
  fallback: PermissionLevel
  inherited?: boolean
  allowInherit?: boolean
  onWildcardChange: (level: PermissionLevel) => void
  onWildcardInherit: () => void
  onExceptionChange: (pattern: string, level: PermissionLevel) => void
  onExceptionAdd: (pattern: string) => void
  onExceptionRemove: (pattern: string) => void
}> = (props) => {
  const language = useLanguage()
  const [adding, setAdding] = createSignal(false)
  const [input, setInput] = createSignal("")
  let ref: HTMLInputElement | undefined

  createEffect(() => {
    if (adding()) ref?.focus()
  })

  const excs = createMemo(() => permissionExceptions(props.rule))
  const level = createMemo(() => wildcardAction(props.rule, props.fallback))

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
          <div style={{ "font-size": "13px", color: "var(--text-base, var(--vscode-foreground))" }}>
            {toolTitle(props.tool.id)}
          </div>
          <div
            style={{
              "font-size": "12px",
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
          <div style={{ "font-size": "12px", color: "var(--text-base, #ccc)" }}>
            {language.t(props.tool.granular.wildcardKey)}
          </div>
        </div>
        <ActionSelect
          level={level()}
          inherited={props.inherited}
          onChange={props.onWildcardChange}
          onInherit={props.allowInherit ? props.onWildcardInherit : undefined}
        />
      </div>

      <Show when={excs().length > 0}>
        <div style={{ "margin-top": "4px" }}>
          <div
            style={{
              "font-size": "12px",
              color: "var(--text-weak-base, var(--vscode-descriptionForeground))",
              "margin-bottom": "4px",
            }}
          >
            {language.t("settings.autoApprove.exceptions")}
          </div>
          <For each={excs()}>
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
                    "font-size": "13px",
                    "font-family": "var(--vscode-editor-font-family, monospace)",
                    color: "var(--text-base, #ccc)",
                    overflow: "hidden",
                    "text-overflow": "ellipsis",
                    "white-space": "nowrap",
                  }}
                  title={exc.pattern}
                >
                  {exc.pattern}
                </div>
                <div style={{ display: "flex", gap: "4px", "align-items": "center", "flex-shrink": 0 }}>
                  <ActionSelect
                    level={exc.action}
                    onChange={(level: PermissionLevel) => props.onExceptionChange(exc.pattern, level)}
                  />
                  <IconButton
                    variant="ghost"
                    size="small"
                    icon="close"
                    onClick={() => props.onExceptionRemove(exc.pattern)}
                  />
                </div>
              </div>
            )}
          </For>
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
              "font-size": "12px",
              color: "var(--text-link-base, #3794ff)",
              "font-family": "inherit",
              "margin-top": "4px",
            }}
            onClick={() => setAdding(true)}
          >
            <span style={{ "font-size": "14px" }}>+</span>
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
              "font-size": "13px",
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
  onChange: (level: PermissionLevel) => void
  onInherit?: () => void
}> = (props) => {
  const language = useLanguage()
  const opts = createMemo(() => (props.onInherit ? [INHERIT_OPTION, ...LEVEL_OPTIONS] : LEVEL_OPTIONS))
  return (
    <Select
      options={opts()}
      current={props.inherited ? INHERIT_OPTION : LEVEL_OPTIONS.find((option) => option.value === props.level)}
      value={(option) => option.value}
      label={(option) => language.t(option.labelKey)}
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

export default PermissionEditor
