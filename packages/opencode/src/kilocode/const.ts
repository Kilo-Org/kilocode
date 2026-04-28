import { InstallationVersion } from "@/installation/version"

export const DEFAULT_HEADERS = {
  "HTTP-Referer": "https://kilocode.ai",
  "X-Title": "Kilo Code",
  "User-Agent": `Kilo-Code/${InstallationVersion}`,
}
