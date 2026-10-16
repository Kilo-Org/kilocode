import type { APIEvent } from "@solidjs/start/server"
import { handleEnterpriseRequest } from "~/lib/enterprise"

// SolidStart keeps only the method export from API routes, so the handler lives in lib.
export async function POST(event: APIEvent) {
  return handleEnterpriseRequest(event.request)
}
