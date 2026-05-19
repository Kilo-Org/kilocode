import { Component, createMemo, createSignal, For, Show } from "solid-js"
import { Select } from "@kilocode/kilo-ui/select"
import { TextField } from "@kilocode/kilo-ui/text-field"
import { Card } from "@kilocode/kilo-ui/card"
import { Button } from "@kilocode/kilo-ui/button"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { Dialog } from "@kilocode/kilo-ui/dialog"
import { useDialog } from "@kilocode/kilo-ui/context/dialog"

import { useConfig } from "../../../context/config"
import { useLanguage } from "../../../context/language"
import type { CommandConfig } from "../../../types/messages"

interface SelectOption {
  value: string
  label: string
}

const REASONING_OPTIONS: SelectOption[] = [
  { value: "", label: "Default" },
  { value: "off", label: "Off" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
]

const WorkflowsTab: Component = () => {
  const language = useLanguage()
  const { config, updateConfig } = useConfig()
  const dialog = useDialog()

  const cmds = createMemo(() => Object.entries(config().command ?? {}))
  const [expanded, setExpanded] = createSignal<Record<string, boolean>>({})

  // New command form
  const [showCreate, setShowCreate] = createSignal(false)
  const [newName, setNewName] = createSignal("")
  const [newTemplate, setNewTemplate] = createSignal("")
  const [newDescription, setNewDescription] = createSignal("")

  // Edit dialog state
  const [editName, setEditName] = createSignal<string | null>(null)
  const [editTemplate, setEditTemplate] = createSignal("")
  const [editDescription, setEditDescription] = createSignal("")

  const toggle = (name: string) => {
    setExpanded((prev) => ({ ...prev, [name]: !prev[name] }))
  }

  // --- CRUD ---

  const updateCommand = (name: string, partial: Partial<CommandConfig>) => {
    const current = config().command ?? {}
    const existing = current[name] ?? {}
    updateConfig({
      command: {
        ...current,
        [name]: { ...existing, ...partial },
      },
    })
  }

  const deleteCommand = (name: string) => {
    const current = { ...(config().command ?? {}) }
    delete current[name]
    updateConfig({ command: current })
  }

  const createCommand = () => {
    const name = newName().trim()
    const template = newTemplate().trim()
    if (!name || !template) return
    const current = config().command ?? {}
    if (current[name]) return
    updateConfig({
      command: {
        ...current,
        [name]: {
          template,
          description: newDescription().trim() || undefined,
        },
      },
    })
    setNewName("")
    setNewTemplate("")
    setNewDescription("")
    setShowCreate(false)
  }

  const openEditDialog = (name: string, cmd: CommandConfig) => {
    setEditName(name)
    setEditTemplate(cmd.template)
    setEditDescription(cmd.description ?? "")
    dialog.show(() => (
      <Dialog
        title={language.t("settings.agentBehaviour.workflows.edit.title")}
        fit
      >
        <div style={{ padding: "16px", "min-width": "400px" }}>
          <div style={{ "margin-bottom": "12px" }}>
            <label
              style={{
                display: "block",
                "font-size": "var(--kilo-font-size-12)",
                "font-weight": "500",
                "margin-bottom": "4px",
              }}
            >
              {language.t("settings.agentBehaviour.workflows.detail.template")}
            </label>
            <TextField
              value={editTemplate()}
              multiline
              placeholder="Enter command template..."
              onChange={setEditTemplate}
            />
          </div>
          <div style={{ "margin-bottom": "16px" }}>
            <label
              style={{
                display: "block",
                "font-size": "var(--kilo-font-size-12)",
                "font-weight": "500",
                "margin-bottom": "4px",
              }}
            >
              {language.t("settings.agentBehaviour.workflows.detail.description")}
            </label>
            <TextField
              value={editDescription()}
              placeholder="Short description..."
              onChange={setEditDescription}
            />
          </div>
          <div
            style={{
              display: "flex",
              "justify-content": "flex-end",
              gap: "8px",
            }}
          >
            <Button variant="ghost" size="large" onClick={() => dialog.close()}>
              {language.t("common.cancel")}
            </Button>
            <Button
              variant="primary"
              size="large"
              onClick={() => {
                const name = editName()
                if (!name) return
                updateCommand(name, {
                  template: editTemplate().trim(),
                  description: editDescription().trim() || undefined,
                })
                dialog.close()
              }}
            >
              {language.t("common.save")}
            </Button>
          </div>
        </div>
      </Dialog>
    ))
  }

  const confirmDelete = (name: string) => {
    dialog.show(() => (
      <Dialog
        title={language.t("settings.agentBehaviour.workflows.delete")}
        fit
      >
        <div class="dialog-confirm-body">
          <span>
            {language.t("settings.agentBehaviour.workflows.confirmDelete", {
              name,
            })}
          </span>
          <div class="dialog-confirm-actions">
            <Button
              variant="ghost"
              size="large"
              onClick={() => dialog.close()}
            >
              {language.t("common.cancel")}
            </Button>
            <Button
              variant="primary"
              size="large"
              onClick={() => {
                deleteCommand(name)
                dialog.close()
              }}
            >
              {language.t("settings.agentBehaviour.workflows.delete")}
            </Button>
          </div>
        </div>
      </Dialog>
    ))
  }

  return (
    <div>
      {/* Description */}
      <div
        style={{
          "font-size": "var(--kilo-font-size-12)",
          color: "var(--text-weak-base, var(--vscode-descriptionForeground))",
          "margin-bottom": "12px",
          "line-height": "1.5",
        }}
      >
        {language.t("settings.agentBehaviour.workflows.description")}
      </div>

      {/* Create new command button + form */}
      <Show
        when={showCreate()}
        fallback={
          <Button
            variant="secondary"
            onClick={() => setShowCreate(true)}
            style={{ "margin-bottom": "12px" }}
          >
            {language.t("settings.agentBehaviour.workflows.newCommand")}
          </Button>
        }
      >
        <Card style={{ "margin-bottom": "12px" }}>
          <div
            style={{
              "font-weight": "500",
              "margin-bottom": "8px",
            }}
          >
            {language.t("settings.agentBehaviour.workflows.create.title")}
          </div>
          <div
            style={{ display: "flex", gap: "8px", "margin-bottom": "8px" }}
          >
            <div style={{ flex: 1 }}>
              <TextField
                value={newName()}
                placeholder={language.t(
                  "settings.agentBehaviour.workflows.create.name.placeholder",
                )}
                onChange={setNewName}
              />
            </div>
            <Button
              variant="secondary"
              onClick={createCommand}
              disabled={!newName().trim() || !newTemplate().trim()}
            >
              {language.t("common.add")}
            </Button>
            <Button variant="ghost" onClick={() => setShowCreate(false)}>
              {language.t("common.cancel")}
            </Button>
          </div>
          <div style={{ "margin-bottom": "8px" }}>
            <TextField
              value={newDescription()}
              placeholder={language.t(
                "settings.agentBehaviour.workflows.detail.description",
              )}
              onChange={setNewDescription}
            />
          </div>
          <TextField
            value={newTemplate()}
            placeholder="Command template (markdown)..."
            multiline
            onChange={setNewTemplate}
          />
        </Card>
      </Show>

      {/* Commands list */}
      <Show
        when={cmds().length > 0}
        fallback={
          <Card>
            <div
              style={{
                "font-size": "var(--kilo-font-size-12)",
                color:
                  "var(--text-weak-base, var(--vscode-descriptionForeground))",
              }}
            >
              {language.t("settings.agentBehaviour.workflows.empty")}
            </div>
          </Card>
        }
      >
        <Card>
          <For each={cmds()}>
            {([name, cmd], index) => {
              const open = () => expanded()[name] ?? false
              return (
                <div
                  style={{
                    "border-bottom":
                      index() < cmds().length - 1
                        ? "1px solid var(--border-weak-base)"
                        : "none",
                  }}
                >
                  {/* Header row */}
                  <div
                    style={{
                      display: "flex",
                      "align-items": "center",
                      "justify-content": "space-between",
                      padding: "8px 0",
                      cursor: "pointer",
                    }}
                    onClick={() => toggle(name)}
                  >
                    <div
                      style={{
                        display: "flex",
                        "align-items": "center",
                        gap: "6px",
                        flex: 1,
                        "min-width": 0,
                      }}
                    >
                      <IconButton
                        size="small"
                        variant="ghost"
                        icon={open() ? "chevron-down" : "chevron-right"}
                        onClick={(e: MouseEvent) => {
                          e.stopPropagation()
                          toggle(name)
                        }}
                      />
                      <span
                        style={{
                          "font-weight": "500",
                          "font-family":
                            "var(--vscode-editor-font-family, monospace)",
                        }}
                      >
                        /{name}
                      </span>
                      <Show when={cmd.description}>
                        <span
                          style={{
                            "font-size": "var(--kilo-font-size-12)",
                            color:
                              "var(--text-weak-base, var(--vscode-descriptionForeground))",
                            overflow: "hidden",
                            "text-overflow": "ellipsis",
                            "white-space": "nowrap",
                          }}
                        >
                          {cmd.description}
                        </span>
                      </Show>
                    </div>
                    {/* Edit/Delete buttons */}
                    <div
                      style={{
                        display: "flex",
                        gap: "2px",
                      }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <IconButton
                        size="small"
                        variant="ghost"
                        icon="edit"
                        onClick={() => openEditDialog(name, cmd)}
                      />
                      <IconButton
                        size="small"
                        variant="ghost"
                        icon="close"
                        onClick={() => confirmDelete(name)}
                      />
                    </div>
                  </div>

                  {/* Expandable detail with per-command settings */}
                  <Show when={open()}>
                    <div
                      style={{
                        "padding-left": "28px",
                        "padding-bottom": "12px",
                      }}
                    >
                      {/* Model override */}
                      <div
                        style={{
                          display: "flex",
                          "align-items": "center",
                          gap: "12px",
                          "padding": "4px 0",
                        }}
                      >
                        <span
                          style={{
                            "font-size": "var(--kilo-font-size-12)",
                            "min-width": "80px",
                            color:
                              "var(--text-weak-base, var(--vscode-descriptionForeground))",
                          }}
                        >
                          {language.t(
                            "settings.agentBehaviour.workflows.model",
                          )}
                        </span>
                        <div style={{ flex: 1 }}>
                          <TextField
                            value={cmd.model ?? ""}
                            placeholder="e.g. anthropic/claude-sonnet-4-20250514"
                            onChange={(val) =>
                              updateCommand(name, {
                                model: val.trim() || undefined,
                              })
                            }
                          />
                        </div>
                      </div>

                      {/* Agent override */}
                      <div
                        style={{
                          display: "flex",
                          "align-items": "center",
                          gap: "12px",
                          "padding": "4px 0",
                        }}
                      >
                        <span
                          style={{
                            "font-size": "var(--kilo-font-size-12)",
                            "min-width": "80px",
                            color:
                              "var(--text-weak-base, var(--vscode-descriptionForeground))",
                          }}
                        >
                          {language.t(
                            "settings.agentBehaviour.workflows.agent",
                          )}
                        </span>
                        <div style={{ flex: 1 }}>
                          <TextField
                            value={cmd.agent ?? ""}
                            placeholder="e.g. code"
                            onChange={(val) =>
                              updateCommand(name, {
                                agent: val.trim() || undefined,
                              })
                            }
                          />
                        </div>
                      </div>

                      {/* Reasoning toggle */}
                      <div
                        style={{
                          display: "flex",
                          "align-items": "center",
                          gap: "12px",
                          "padding": "4px 0",
                        }}
                      >
                        <span
                          style={{
                            "font-size": "var(--kilo-font-size-12)",
                            "min-width": "80px",
                            color:
                              "var(--text-weak-base, var(--vscode-descriptionForeground))",
                          }}
                        >
                          {language.t(
                            "settings.agentBehaviour.workflows.reasoning",
                          )}
                        </span>
                        <div style={{ flex: 1 }}>
                          <Select
                            options={REASONING_OPTIONS}
                            current={REASONING_OPTIONS.find(
                              (o) => o.value === (cmd.reasoning ?? ""),
                            )}
                            value={(o) => o.value}
                            label={(o) => o.label}
                            onSelect={(o) => {
                              if (!o) return
                              updateCommand(name, {
                                reasoning:
                                  (o.value as
                                    | "off"
                                    | "low"
                                    | "medium"
                                    | "high") || undefined,
                              })
                            }}
                            variant="secondary"
                            size="small"
                            triggerVariant="settings"
                          />
                        </div>
                      </div>

                      {/* Template preview */}
                      <Show when={cmd.template}>
                        <div
                          style={{
                            "margin-top": "8px",
                            "padding-top": "8px",
                            "border-top": "1px solid var(--border-weak-base)",
                          }}
                        >
                          <span
                            style={{
                              "font-size": "var(--kilo-font-size-12)",
                              "font-weight": "500",
                              color:
                                "var(--text-weak-base, var(--vscode-descriptionForeground))",
                            }}
                          >
                            {language.t(
                              "settings.agentBehaviour.workflows.detail.template",
                            )}
                            :
                          </span>
                          <div
                            style={{
                              "margin-top": "4px",
                              "font-family":
                                "var(--vscode-editor-font-family, monospace)",
                              "font-size": "var(--kilo-font-size-11)",
                              "white-space": "pre-wrap",
                              "word-break": "break-word",
                              color:
                                "var(--text-weak-base, var(--vscode-descriptionForeground))",
                              "max-height": "120px",
                              overflow: "auto",
                            }}
                          >
                            {cmd.template}
                          </div>
                        </div>
                      </Show>
                    </div>
                  </Show>
                </div>
              )
            }}
          </For>
        </Card>
      </Show>
    </div>
  )
}

export default WorkflowsTab
