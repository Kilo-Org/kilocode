import { createMemo, createSignal } from "solid-js"
import type { Config, PermissionRuleConfig } from "@kilocode/sdk/v2"
import { useDialog } from "../ui/dialog"
import { DialogSelect, type DialogSelectOption } from "../ui/dialog-select"
import { DialogPrompt } from "../ui/dialog-prompt"
import { useSync } from "../context/sync"
import { useSDK } from "../context/sdk"
import { useToast } from "../ui/toast"
import { useTheme } from "../context/theme"

type Class = "read" | "act" | "navigate"

const CLASSES: Class[] = ["read", "act", "navigate"]

const CLASS_LABEL: Record<Class, string> = { read: "read", act: "act", navigate: "navigate" }

type Rule = { pattern: string; class: Class; origin: string }

/** `<class>:<origin>`, or undefined when the key is not a browser rule. */
function rule(pattern: string): Rule | undefined {
  const index = pattern.indexOf(":")
  if (index < 1) return undefined
  const cls = pattern.slice(0, index)
  if (cls !== "read" && cls !== "act" && cls !== "navigate") return undefined
  const origin = pattern.slice(index + 1)
  if (!origin.startsWith("http://") && !origin.startsWith("https://")) return undefined
  return { pattern, class: cls, origin }
}

function origin(value: string) {
  const trimmed = value.trim()
  if (!/^https?:\/\/[^\s/]+/.test(trimmed)) return undefined
  try {
    return new URL(trimmed).origin
  } catch {
    return undefined
  }
}

/**
 * `/browser`: the backend, its connection state, the organization policy and the site
 * allowlist. Rules are written to the global config, the same place the CLI reads them.
 */
export function DialogBrowser() {
  const dialog = useDialog()
  const sync = useSync()
  const sdk = useSDK()
  const toast = useToast()
  const { theme } = useTheme()
  const [busy, setBusy] = createSignal(false)

  const config = () => sync.data.globalConfig
  // The permission block is either the scalar form ("allow") or an object of rules.
  const saved = (): PermissionRuleConfig | undefined => {
    const permission = config().permission
    if (!permission || typeof permission !== "object") return undefined
    return permission.browser
  }
  const allowAll = () => saved() === "allow"
  const policy = () => sync.data.console_state.browserPolicy

  const rules = createMemo(() => {
    const value = saved()
    if (!value || typeof value !== "object") return []
    return Object.entries(value)
      .filter(([, action]) => action === "allow")
      .flatMap(([pattern]) => {
        const parsed = rule(pattern)
        return parsed ? [parsed] : []
      })
  })

  const backend = () => {
    if (policy()?.control === "off") return "off (organization policy)"
    if (policy()?.control === "playwright_only") return "playwright (organization policy)"
    return config().browser?.backend ?? "playwright"
  }

  const status = () => {
    if (policy()?.control === "off") return "Organization policy turns browser tools off."
    if (policy()?.control === "playwright_only") return "Organization policy keeps browser tools on the bundled Playwright browser."
    if ((config().browser?.backend ?? "playwright") === "off") return "Browser tools are off."
    if ((config().browser?.backend ?? "playwright") === "extension")
      return "Not connected. The extension backend arrives in a later release."
    return "Bundled Playwright browser; it starts with the first browser tool call."
  }

  const write = async (browser: Record<string, "allow" | null> | "allow" | null) => {
    if (busy()) return
    setBusy(true)
    try {
      // `null` is the config delete sentinel the server understands; the generated type omits it.
      const permission = { browser } as unknown as NonNullable<Config["permission"]>
      await sdk.client.global.config.update({ config: { permission } }, { throwOnError: true })
    } catch (error) {
      toast.show({ variant: "error", message: error instanceof Error ? error.message : "Could not save the browser rules" })
    } finally {
      setBusy(false)
    }
  }

  const add = async () => {
    const answer = await DialogPrompt.show(dialog, "Site origin", {
      placeholder: "https://example.com",
      description: () => <text fg={theme.textMuted}>Localhost sites are allowed already.</text>,
    })
    if (answer === null) return
    const value = origin(answer)
    if (!value) {
      toast.show({ variant: "error", message: "Enter an http:// or https:// origin" })
      return
    }
    dialog.replace(() => <DialogBrowserClasses origin={value} />)
  }

  const remove = async (entry: Rule) => {
    // null is the config delete sentinel: it removes this rule and keeps the rest.
    await write({ [entry.pattern]: null })
  }

  const options = createMemo<DialogSelectOption<string>[]>(() => {
    if (allowAll()) {
      return [
        {
          title: "All sites allowed",
          value: "allow-all",
          description: "Every origin is allowed for every class",
        },
      ]
    }
    return rules().map((entry) => ({
      title: `${CLASS_LABEL[entry.class]} ${entry.origin}`,
      value: entry.pattern,
      description: "Saved rule",
    }))
  })

  const actions = createMemo(() => [
    {
      command: "dialog.browser.add",
      title: "add site",
      side: "left" as const,
      onTrigger: () => void add(),
    },
    {
      command: "dialog.browser.remove",
      title: "remove",
      side: "left" as const,
      requiresSelection: true as const,
      onTrigger: (option: DialogSelectOption<string>) => {
        const entry = rules().find((item) => item.pattern === option.value)
        if (entry) void remove(entry)
      },
    },
    {
      command: "dialog.browser.allow_all",
      title: allowAll() ? "stop allowing all" : "allow all sites",
      side: "left" as const,
      // "Allow all" is the scalar form; turning it off deletes the key and restores the defaults.
      onTrigger: () => void write(allowAll() ? null : "allow"),
    },
    {
      command: "dialog.browser.sensitive",
      title: config().browser?.allowSensitive ? "ask for sensitive steps" : "allow sensitive steps",
      side: "left" as const,
      onTrigger: () =>
        void sdk.client.global.config
          .update({ config: { browser: { allowSensitive: !config().browser?.allowSensitive } } })
          .catch((error: unknown) =>
            toast.show({ variant: "error", message: error instanceof Error ? error.message : "Could not save" }),
          ),
    },
  ])

  return (
    <DialogSelect
      title="Browser"
      options={options()}
      actions={actions()}
      placeholder="Filter sites"
      footer={
        <box flexDirection="column">
          <text fg={theme.textMuted}>backend: {backend()}</text>
          <text fg={theme.textMuted}>{status()}</text>
          <text fg={theme.textMuted}>
            sensitive steps: {config().browser?.allowSensitive ? "allowed without asking" : "need a human reply"}
          </text>
        </box>
      }
      onSelect={() => {
        // Selecting a rule is a no-op; removal is the explicit action.
      }}
    />
  )
}

/** Second step of adding a site: which classes to grant on that origin. */
function DialogBrowserClasses(props: { origin: string }) {
  const dialog = useDialog()
  const sdk = useSDK()
  const toast = useToast()
  const [chosen, setChosen] = createSignal<Class[]>(["read"])
  const { theme } = useTheme()
  const [busy, setBusy] = createSignal(false)

  const toggle = (value: Class) =>
    setChosen((current) => (current.includes(value) ? current.filter((item) => item !== value) : [...current, value]))

  const save = async () => {
    if (busy() || chosen().length === 0) return
    setBusy(true)
    try {
      const rules = Object.fromEntries(chosen().map((cls) => [`${cls}:${props.origin}`, "allow" as const]))
      await sdk.client.global.config.update({ config: { permission: { browser: rules } } }, { throwOnError: true })
      dialog.clear()
    } catch (error) {
      toast.show({ variant: "error", message: error instanceof Error ? error.message : "Could not save the browser rules" })
    } finally {
      setBusy(false)
    }
  }

  return (
    <DialogSelect
      title={`Allow on ${props.origin}`}
      options={CLASSES.map((value) => ({
        title: CLASS_LABEL[value],
        value,
        footer: chosen().includes(value) ? "✓ allowed" : "○",
      }))}
      actions={[
        { command: "dialog.browser.toggle", title: "toggle", onTrigger: (option) => toggle(option.value as Class) },
        { command: "dialog.browser.save", title: "save", side: "right", onTrigger: () => void save() },
      ]}
      onSelect={(option) => toggle(option.value as Class)}
    />
  )
}
