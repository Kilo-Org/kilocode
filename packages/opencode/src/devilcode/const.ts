import { Installation } from "@/installation"

export const DEFAULT_HEADERS = {
  "HTTP-Referer": "https://kilocode.ai",
  "X-Title": "Kilo Code",
  "User-Agent": `Kilo-Code/${Installation.VERSION}`,
}
