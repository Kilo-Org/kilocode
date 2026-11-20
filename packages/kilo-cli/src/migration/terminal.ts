import { createInterface } from "node:readline"
import type { MigrationProgress } from "./owner"
import type { preflight } from "./preflight"

// Literal imports keep the selected dictionary available in the standalone executable.
const dictionaries = {
  ar: () => import("@kilocode/kilo-i18n/ar"),
  bs: () => import("@kilocode/kilo-i18n/bs"),
  da: () => import("@kilocode/kilo-i18n/da"),
  de: () => import("@kilocode/kilo-i18n/de"),
  en: () => import("@kilocode/kilo-i18n/en"),
  es: () => import("@kilocode/kilo-i18n/es"),
  fr: () => import("@kilocode/kilo-i18n/fr"),
  it: () => import("@kilocode/kilo-i18n/it"),
  ja: () => import("@kilocode/kilo-i18n/ja"),
  ko: () => import("@kilocode/kilo-i18n/ko"),
  nl: () => import("@kilocode/kilo-i18n/nl"),
  no: () => import("@kilocode/kilo-i18n/no"),
  pl: () => import("@kilocode/kilo-i18n/pl"),
  pt: () => import("@kilocode/kilo-i18n/br"),
  ru: () => import("@kilocode/kilo-i18n/ru"),
  th: () => import("@kilocode/kilo-i18n/th"),
  tr: () => import("@kilocode/kilo-i18n/tr"),
  uk: () => import("@kilocode/kilo-i18n/uk"),
  zh: () => import("@kilocode/kilo-i18n/zh"),
  zht: () => import("@kilocode/kilo-i18n/zht"),
}

export async function terminalCutover(
  plan: ReturnType<typeof preflight>,
  run: (report: (progress: MigrationProgress) => void) => Promise<void>,
): Promise<boolean> {
  const locale = messageLocale()
  const { dict } = await dictionaries[locale]()
  const t = (key: keyof typeof dict, vars: Record<string, string> = {}) =>
    dict[key].replace(/\{\{(\w+)\}\}/g, (match, name: string) => vars[name] ?? match)

  if (!process.stdin.isTTY || !process.stdout.isTTY || !process.stderr.isTTY) {
    const guidance = t("migration.headless", {
      preflight: "kilo2 migrate preflight",
      apply: "kilo2 migrate apply --accept-jetbrains-breakage",
    })
    throw new Error(`${t("migration.warning")}\n${guidance}`)
  }
  const bytes = new Intl.NumberFormat(locale === "zht" ? "zh-TW" : locale === "pt" ? "pt-BR" : locale, {
    style: "unit",
    unit: "byte",
    unitDisplay: "long",
  })
  const summary = t("migration.summary", {
    source: plan.source,
    sourceBytes: bytes.format(plan.sourceBytes),
    walBytes: bytes.format(plan.walBytes),
    totalBytes: bytes.format(plan.sourceBytes + plan.walBytes),
    availableBytes: bytes.format(plan.availableBytes),
    backup: plan.backup,
  })
  process.stderr.write(`${t("migration.title")}\n${summary}\n\n${t("migration.warning")}\n\n`)
  if (!(await confirm(`y: ${t("migration.accept")}\nEnter: ${t("migration.notNow")}\n[y/N] `))) return false

  process.stderr.write(`${t("migration.progress")}\n`)
  await run(({ phase, done, total }) => {
    const count =
      done === undefined && total === undefined ? "" : ` ${done ?? "?"}${total === undefined ? "" : `/${total}`}`
    process.stderr.write(`${phase}${count}\n`)
  })
  return true
}

function confirm(prompt: string) {
  const rl = createInterface({ input: process.stdin, output: process.stderr })
  return new Promise<boolean>((resolve) => {
    rl.once("close", () => resolve(false))
    rl.once("SIGINT", () => rl.close())
    rl.question(prompt, (answer) => resolve(/^(y|yes)$/i.test(answer.trim())))
  }).finally(() => rl.close())
}

function messageLocale(): keyof typeof dictionaries {
  const lang =
    process.env.LC_ALL || process.env.LC_MESSAGES || process.env.LANG || Intl.DateTimeFormat().resolvedOptions().locale
  const tag = lang.split(/[.@]/)[0]!.toLowerCase().replaceAll("_", "-")
  const language = tag.split("-")[0]!
  if (language === "zh" && /-(hant|tw|hk|mo)\b/.test(tag)) return "zht"
  if (language === "nb" || language === "nn") return "no"
  return Object.hasOwn(dictionaries, language) ? (language as keyof typeof dictionaries) : "en"
}
