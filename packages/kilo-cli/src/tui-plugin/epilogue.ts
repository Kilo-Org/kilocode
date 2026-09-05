import { logo, supports } from "./logo-data"

const reset = "\x1b[0m"
const bold = "\x1b[1m"
const dim = "\x1b[90m"
const white = "\x1b[38;2;255;255;255m"

export function sessionEpilogue(input: { title: string; sessionID?: string }) {
  const width = process.stdout.columns ?? 80
  const artwork = supports()
    ? width < 52
      ? logo.modern.compact
      : logo.modern.plain
    : width < 52
      ? logo.fallback.compact
      : logo.fallback.plain
  const weak = (text: string) => `${dim}${text.padEnd(10, " ")}${reset}`
  return [
    ...artwork.map((line) => `  ${white}${line.trimEnd()}${reset}`),
    "",
    `  ${weak("Session")}${bold}${input.title}${reset}`,
    ...(input.sessionID ? [`  ${weak("Continue")}${bold}kilo2 -s ${input.sessionID}${reset}`] : []),
    "",
  ].join("\n")
}
