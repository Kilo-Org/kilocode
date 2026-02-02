/**
 * Autocomplete system for CLI input.
 *
 * This module provides a generic, extensible autocomplete system that supports
 * multiple trigger patterns (like @ for files, / for commands) through a
 * plugin-like trigger architecture.
 *
 * @example
 * ```tsx
 * import {
 *   AutocompleteInput,
 *   PickerSelect,
 *   useAutocompletePicker,
 *   createFileTrigger,
 *   createSlashCommandTrigger,
 * } from './autocomplete'
 *
 * const triggers = [
 *   createFileTrigger({ onSearch, getResults }),
 *   createSlashCommandTrigger({ getCommands }),
 * ]
 *
 * <AutocompleteInput
 *   triggers={triggers}
 *   onSubmit={handleSubmit}
 * />
 * ```
 */

// Main components
export { type AutocompleteInputProps, type AutocompleteInputHandle, AutocompleteInput } from "./AutocompleteInput.js"
export { type PickerSelectProps, PickerSelect } from "./PickerSelect.js"

// Hook
export { useAutocompletePicker } from "./useAutocompletePicker.js"

// Types
export * from "./types.js"

// Triggers
export * from "./triggers/index.js"
