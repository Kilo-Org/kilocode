import type { JSX } from "solid-js"

export function cx(...input: Array<string | false | null | undefined>) {
  return input.filter(Boolean).join(" ")
}

export function css(style: JSX.CSSProperties | string | undefined, vars: Record<string, string | number | undefined>) {
  const next = Object.fromEntries(Object.entries(vars).filter((entry) => entry[1] !== undefined))
  if (typeof style === "string") {
    const extra = Object.entries(next)
      .map((entry) => `${entry[0]}:${entry[1]}`)
      .join(";")
    return extra ? `${style};${extra}` : style
  }
  return { ...(style ?? {}), ...next } as JSX.CSSProperties
}
