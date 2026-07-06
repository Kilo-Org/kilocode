import { For, Show } from "solid-js"
import { Button } from "@kilocode/kilo-web-ui/button"
import { ConfigRow, SectionTitle } from "@kilocode/kilo-web-ui/console"
import { IconButton } from "@kilocode/kilo-web-ui/icon-button"
import { toolName } from "../../shared/utils"
import { ConfigCountTag as CountTag, ConfigPage, ConfigTag as Tag, SourceBadge } from "./ConfigPage"
import { actions, usePermissionSettings, type PermissionAction, type PermissionRule } from "./state/permissions"

export function tone(action: PermissionAction) {
  if (action === "allow") return "success"
  if (action === "deny") return "critical"
  return "warning"
}

export function label(action: PermissionAction) {
  return actions.find((item) => item.value === action)?.label ?? action
}

export function RuleMeta(props: { rule: PermissionRule }) {
  return (
    <div class="permission-row-meta">
      <Tag tone={tone(props.rule.action)}>{label(props.rule.action)}</Tag>
      <SourceBadge source={props.rule.source} inherited={props.rule.inherited} overridden={props.rule.overridden} />
    </div>
  )
}

export function ActionSelect(props: {
  label: string
  value: PermissionAction
  disabled?: boolean
  onSelect: (value: PermissionAction) => void
}) {
  const current = () => label(props.value)

  function choose(value: PermissionAction, event: MouseEvent & { currentTarget: HTMLButtonElement }) {
    if (props.disabled) return
    props.onSelect(value)
    event.currentTarget.closest("details")?.removeAttribute("open")
  }

  function toggle(event: Event & { currentTarget: HTMLDetailsElement }) {
    if (props.disabled) {
      event.currentTarget.removeAttribute("open")
      return
    }
    if (!event.currentTarget.open) return
    event.currentTarget.parentElement?.querySelectorAll(".models-select[open]").forEach((node) => {
      if (node !== event.currentTarget) node.removeAttribute("open")
    })
  }

  return (
    <details class="models-select permission-select" classList={{ disabled: props.disabled }} onToggle={toggle}>
      <summary aria-label={props.label} aria-disabled={props.disabled}>
        {current()}
      </summary>
      <div class="models-select-menu" role="listbox" aria-label={props.label}>
        <For each={actions}>
          {(item) => (
            <button
              class="models-select-option"
              classList={{ selected: item.value === props.value }}
              type="button"
              role="option"
              aria-selected={item.value === props.value}
              onClick={(event) => choose(item.value, event)}
            >
              {item.label}
            </button>
          )}
        </For>
      </div>
    </details>
  )
}

export function PermissionsRoute() {
  const state = usePermissionSettings()

  return (
    <ConfigPage
      title={
        <span class="config-title-count">
          Permissions
          <CountTag>{state.groups().length + state.settings().length}</CountTag>
        </span>
      }
      description="Control what tools agents can use by default and add pattern-specific allow, ask, or deny rules."
    >
      <div class="permissions">
        <For each={state.groups()}>
          {(group) => (
            <section class="permission-group">
              <header class="permission-group-header">
                <div class="permission-group-copy">
                  <h2>{group.title}</h2>
                  <span>{group.id}</span>
                  <p>{group.description}</p>
                </div>
                <div class="permission-section-actions">
                  <CountTag>{group.rules.length}</CountTag>
                  <Button
                    icon="plus"
                    variant="primary"
                    disabled={Boolean(state.ctx.saving())}
                    onClick={() => state.open(group.id)}
                  >
                    Add rule
                  </Button>
                </div>
              </header>

              <ConfigRow
                title="Default method"
                subtitle={`Used for ${group.noun}s that do not match a specific rule.`}
                status={
                  <div class="permission-row-meta">
                    <SourceBadge source={group.source} inherited={group.inherited} overridden={group.overridden} />
                  </div>
                }
                actions={
                  <ActionSelect
                    label={`Default method for ${group.title}`}
                    value={group.action}
                    disabled={Boolean(state.ctx.saving())}
                    onSelect={(action) => state.setDefault(group.id, action)}
                  />
                }
              />

              <div class="permission-rules">
                <Show
                  when={group.rules.length}
                  fallback={<p class="permission-empty">No specific {group.noun} rules.</p>}
                >
                  <For each={group.rules}>
                    {(rule) => (
                      <ConfigRow
                        title={<span class="permission-pattern">{rule.pattern}</span>}
                        subtitle={`${group.title} ${group.noun} rule`}
                        status={<RuleMeta rule={rule} />}
                        actions={
                          <IconButton
                            icon="trash"
                            variant="ghost"
                            aria-label={`Delete ${group.title} rule ${rule.pattern}`}
                            disabled={Boolean(state.ctx.saving())}
                            onClick={() => state.remove(rule)}
                          />
                        }
                      />
                    )}
                  </For>
                </Show>
              </div>
            </section>
          )}
        </For>

        <section class="permission-group">
          <SectionTitle
            trailing={<CountTag>{state.settings().length}</CountTag>}
            description="Default methods for additional built-in tool permissions."
          >
            Tool Defaults
          </SectionTitle>
          <div class="permission-rules">
            <For each={state.settings()}>
              {(item) => (
                <ConfigRow
                  title={item.title}
                  subtitle={`${item.id} · ${item.description}`}
                  status={
                    <div class="permission-row-meta">
                      <SourceBadge source={item.source} inherited={item.inherited} overridden={item.overridden} />
                    </div>
                  }
                  actions={
                    <ActionSelect
                      label={`Default method for ${item.title}`}
                      value={item.action}
                      disabled={Boolean(state.ctx.saving())}
                      onSelect={(action) => state.setDefault(item.id, action)}
                    />
                  }
                />
              )}
            </For>
          </div>
        </section>

        <Show when={state.other().length}>
          <section class="permission-group">
            <SectionTitle
              trailing={<CountTag>{state.other().length}</CountTag>}
              description="Additional tool permission rules from config."
            >
              Other Permissions
            </SectionTitle>
            <div class="permission-rules">
              <For each={state.other()}>
                {(rule) => (
                  <ConfigRow
                    title={toolName(rule.tool)}
                    subtitle={
                      <span class="permission-subtitle">
                        <span>{rule.tool}</span>
                        <span class="permission-pattern">{rule.pattern}</span>
                      </span>
                    }
                    status={<RuleMeta rule={rule} />}
                    actions={
                      <IconButton
                        icon="trash"
                        variant="ghost"
                        aria-label={`Delete ${rule.tool} rule ${rule.pattern}`}
                        disabled={Boolean(state.ctx.saving())}
                        onClick={() => state.remove(rule)}
                      />
                    }
                  />
                )}
              </For>
            </div>
          </section>
        </Show>
      </div>

      <Show when={state.mode() === "rule"}>
        <div class="drawer-scrim" onClick={state.close} />
        <aside class="provider-drawer permission-drawer" aria-label="Permission rule configuration">
          <header class="drawer-header">
            <div>
              <h2>{`Add ${state.selected().title} Rule`}</h2>
              <span>{`${state.selected().id} · ${state.selected().description}`}</span>
            </div>
            <Button variant="ghost" aria-label="Close permission rule overlay" onClick={state.close}>
              X
            </Button>
          </header>

          <div class="provider-form permission-form">
            <label class="required-field wide">
              {state.selected().noun === "command" ? "Command pattern" : "Path pattern"}
              <input
                value={state.pattern()}
                placeholder={state.selected().placeholder}
                spellcheck={false}
                onInput={(event) => state.setPattern(event.currentTarget.value)}
              />
            </label>
            <label class="required-field wide">
              Method
              <ActionSelect
                label="Rule method"
                value={state.action()}
                disabled={Boolean(state.ctx.saving())}
                onSelect={state.setAction}
              />
            </label>
          </div>

          <footer class="drawer-footer">
            <Button variant="ghost" onClick={state.close}>
              Cancel
            </Button>
            <Button variant="primary" disabled={Boolean(state.ctx.saving())} onClick={state.add}>
              Save Rule
            </Button>
          </footer>
        </aside>
      </Show>
    </ConfigPage>
  )
}
