import type { FormAnswer, FormField, FormIntegerField, FormNumberField, FormValue } from "@opencode/client"

export type Draft = Record<string, FormValue | undefined>

type ValidatedValue = { value: FormValue | undefined } | { error: string }

export function formAnswer(fields: FormField[], values: Draft, custom: Record<string, string> = {}) {
  const answer: FormAnswer = {}
  const visible: FormField[] = []
  const errors: string[] = []
  // Conditions depend on answers accepted earlier in this pass, not on the draft.
  fields.forEach((field) => {
    const visibility = fieldVisibility(field, answer)
    if (visibility === "inactive") return
    if (visibility === "visible") visible.push(field)

    const result = validateValue(field, normalizeValue(field, values, custom))
    if ("error" in result) {
      errors.push(result.error)
      return
    }
    if (result.value !== undefined) answer[field.key] = result.value
  })
  return { answer, visible, errors }
}

function fieldVisibility(field: FormField, answer: FormAnswer) {
  if (field.type === "external") return "visible"
  if (
    field.when &&
    !field.when.every((condition) => {
      const value = answer[condition.key]
      if (value === undefined) return false
      const matches = Array.isArray(value) ? value.includes(String(condition.value)) : value === condition.value
      return condition.op === "eq" ? matches : !matches
    })
  )
    return "inactive"
  return field.hidden ? "hidden" : "visible"
}

function normalizeValue(field: FormField, values: Draft, custom: Record<string, string>) {
  if (field.type === "external") return values[field.key]
  const value = values[field.key] ?? field.default ?? (field.type === "boolean" ? false : undefined)
  const extra = custom[field.key]?.trim()
  const result =
    field.type === "multiselect"
      ? [...new Set([...(Array.isArray(value) ? value : []), ...(field.custom && extra ? [extra] : [])])]
      : field.type === "string" && field.custom && extra
        ? extra
        : value
  if ((typeof result === "string" && !result.trim()) || (Array.isArray(result) && !result.length)) return undefined
  return result
}

function validateValue(field: FormField, value: FormValue | undefined): ValidatedValue {
  if (field.type === "external") {
    // The server requires exactly `true` to acknowledge an external link.
    return value === true ? { value } : { error: `${field.title || field.key}: open the link first.` }
  }
  if (value === undefined) return field.required ? { error: `${field.title || field.key} is required.` } : { value }
  if (field.type === "number" || field.type === "integer") return validateNumber(field, value)
  if (
    field.type === "multiselect" &&
    Array.isArray(value) &&
    ((field.minItems !== undefined && value.length < field.minItems) ||
      (field.maxItems !== undefined && value.length > field.maxItems))
  )
    return { error: `${field.title || field.key} has an invalid number of selections.` }
  return { value }
}

function validateNumber(field: FormNumberField | FormIntegerField, value: FormValue): ValidatedValue {
  const number = Number(value)
  if (!Number.isFinite(number) || (field.type === "integer" && !Number.isInteger(number)))
    return { error: `${field.title || field.key} must be ${field.type === "integer" ? "an integer" : "a number"}.` }
  if (
    (field.minimum !== undefined && number < Number(field.minimum)) ||
    (field.maximum !== undefined && number > Number(field.maximum))
  )
    return { error: `${field.title || field.key} is outside the allowed range.` }
  return { value: number }
}
