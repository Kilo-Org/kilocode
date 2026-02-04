// Export existing hooks
export { TerminalSizeProvider, useTerminalSize } from "./TerminalSizeContext.js"
export { useToast, useToastStore } from "./useToast.js"
export { useInputHistory } from "./useInputHistory.js"

// Export new extracted hooks
export { useFollowupCountdown } from "./useFollowupCountdown.js"
export { useFocusManagement } from "./useFocusManagement.js"
export { useMessageHandlers } from "./useMessageHandlers.js"
export { useExtensionHost } from "./useExtensionHost.js"
export { useTaskSubmit } from "./useTaskSubmit.js"
export { useGlobalInput } from "./useGlobalInput.js"
export { usePickerHandlers } from "./usePickerHandlers.js"

// Export types
export type { UseFollowupCountdownOptions } from "./useFollowupCountdown.js"
export type { UseFocusManagementOptions, UseFocusManagementReturn } from "./useFocusManagement.js"
export type { UseMessageHandlersOptions, UseMessageHandlersReturn } from "./useMessageHandlers.js"
export type { UseExtensionHostOptions, UseExtensionHostReturn } from "./useExtensionHost.js"
export type { UseTaskSubmitOptions, UseTaskSubmitReturn } from "./useTaskSubmit.js"
export type { UseGlobalInputOptions } from "./useGlobalInput.js"
export type { UsePickerHandlersOptions, UsePickerHandlersReturn } from "./usePickerHandlers.js"
