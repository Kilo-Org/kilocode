export function variantChoices(values: string[]) {
  return [
    { value: "", label: "Inherit" },
    { value: "default", label: "Model default" },
    ...[...values].sort((a, b) => a.localeCompare(b)).map((value) => ({ value, label: value })),
  ]
}

export function variantEdit(input: {
  scope: "global" | "project"
  inherited?: boolean
  editable?: boolean
  native?: boolean
  source?: string
}) {
  if (input.source === "organization") return false
  if (input.native) return true
  if (input.editable === false) return false
  if (input.scope === "project") return true
  return !input.inherited
}

export function variantParent(input: { scope: "global" | "project"; global: unknown }) {
  if (input.scope === "global") return ""
  return text(input.global)
}

export function variantValue(input: { cfg: unknown; effective: unknown }) {
  return text(input.cfg) || text(input.effective)
}

export function variantState(input: {
  scope: "global" | "project"
  global: unknown
  local: unknown
  effective: unknown
}) {
  const stored = input.scope === "global" ? text(input.global) : text(input.local)
  return {
    stored,
    shown: variantValue({ cfg: stored, effective: input.effective }),
  }
}

export function variantModel(input: { draft: string; agent: string; workspace: unknown }) {
  return input.draft || input.agent || text(input.workspace)
}

export function variantCurrent(input: { current: string; saved: string; variants: string[] }) {
  if (input.current === "default") return "default"
  if (input.variants.includes(input.current)) return input.current
  if (input.saved === "default") return "default"
  if (input.variants.includes(input.saved)) return input.saved
  return ""
}

export function variantShown(input: { cleared: boolean; current: string; saved: string; variants: string[] }) {
  if (input.cleared) return ""
  return variantCurrent({ current: input.current, saved: input.saved, variants: input.variants })
}

export function variantPersist(input: { cleared: boolean; current: string; saved: string; variants: string[] }) {
  if (!input.cleared && input.current === input.saved) return input.saved
  return variantShown(input)
}

export function variantDirty(input: { next: string; saved: string }) {
  return input.next !== input.saved
}

function text(input: unknown) {
  if (typeof input === "string") return input
  return ""
}
