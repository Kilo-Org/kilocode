import type { FormAnswer, FormField, FormValue } from "@opencode/client"

export type Draft = Record<string, FormValue | undefined>

export function formAnswer(fields: FormField[], values: Draft, custom: Record<string, string> = {}) {
  const answer: FormAnswer = {}
  const visible: FormField[] = []
  const errors: string[] = []
  fields.forEach((field) => {
    if (field.type === "external") {
      visible.push(field)
      return
    }
    if (
      field.when &&
      !field.when.every((condition) => {
        const value = answer[condition.key]
        if (value === undefined) return false
        const matches = Array.isArray(value) ? value.includes(String(condition.value)) : value === condition.value
        return condition.op === "eq" ? matches : !matches
      })
    )
      return
    if (!field.hidden) visible.push(field)
    const value = values[field.key] ?? field.default ?? (field.type === "boolean" ? false : undefined)
    const extra = custom[field.key]?.trim()
    const result =
      field.type === "multiselect"
        ? [...new Set([...(Array.isArray(value) ? value : []), ...(field.custom && extra ? [extra] : [])])]
        : field.type === "string" && field.custom && extra
          ? extra
          : value
    const empty =
      result === undefined ||
      (typeof result === "string" && !result.trim()) ||
      (Array.isArray(result) && !result.length)
    if (empty) {
      if (field.required) errors.push(`${field.title || field.key} is required.`)
      return
    }
    if (field.type === "number" || field.type === "integer") {
      const number = Number(result)
      if (!Number.isFinite(number) || (field.type === "integer" && !Number.isInteger(number))) {
        errors.push(`${field.title || field.key} must be ${field.type === "integer" ? "an integer" : "a number"}.`)
        return
      }
      if (
        (field.minimum !== undefined && number < Number(field.minimum)) ||
        (field.maximum !== undefined && number > Number(field.maximum))
      ) {
        errors.push(`${field.title || field.key} is outside the allowed range.`)
        return
      }
      answer[field.key] = number
      return
    }
    if (
      field.type === "multiselect" &&
      Array.isArray(result) &&
      ((field.minItems !== undefined && result.length < field.minItems) ||
        (field.maxItems !== undefined && result.length > field.maxItems))
    ) {
      errors.push(`${field.title || field.key} has an invalid number of selections.`)
      return
    }
    answer[field.key] = result
  })
  return { answer, visible, errors }
}
