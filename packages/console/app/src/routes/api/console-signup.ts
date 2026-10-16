import type { APIEvent } from "@solidjs/start/server"
import { Resource } from "@opencode/console-resource"
import { handleConsoleSignup } from "~/lib/console-signup"

// SolidStart keeps only the method export from API routes, so the handler lives in lib.
export async function POST(event: APIEvent) {
  return handleConsoleSignup(event.request, Resource.CONSOLE_CRM_TOKEN.value)
}
