// Re-export device auth types from @roo-code/types
export type { DeviceAuthInitiateResponse, DeviceAuthPollResponse, DeviceAuthState } from "@roo-code/types"
export { DeviceAuthInitiateResponseSchema, DeviceAuthPollResponseSchema } from "@roo-code/types"

// Kilocode-specific auth types
export * from "./kilocode.js"
