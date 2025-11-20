import { z } from "zod"

/**
 * CodeAction
 */

export const kiloCodeActionIds = ["addToContextAndFocus"] as const // kilocode_change
export const codeActionIds = [
	...kiloCodeActionIds, // kilocode_change
	"explainCode",
	"fixCode",
	"improveCode",
	"addToContext",
	"newTask",
] as const

export type CodeActionId = (typeof codeActionIds)[number]

export type CodeActionName = "EXPLAIN" | "FIX" | "IMPROVE" | "ADD_TO_CONTEXT" | "NEW_TASK"

/**
 * TerminalAction
 */

export const terminalActionIds = ["terminalAddToContext", "terminalFixCommand", "terminalExplainCommand"] as const

export type TerminalActionId = (typeof terminalActionIds)[number]

export type TerminalActionName = "ADD_TO_CONTEXT" | "FIX" | "EXPLAIN"

export type TerminalActionPromptType = `TERMINAL_${TerminalActionName}`

/**
 * Command
 */

export const commandIds = [
	"activationCompleted",

	"plusButtonClicked",
	"promptsButtonClicked",
	"mcpButtonClicked",

	"historyButtonClicked",
	"marketplaceButtonClicked",
	"popoutButtonClicked",
	"cloudButtonClicked",
	"settingsButtonClicked",

	"openInNewTab",

	"showHumanRelayDialog",
	"registerHumanRelayCallback",
	"unregisterHumanRelayCallback",
	"handleHumanRelayResponse",

	"newTask",

	"setCustomStoragePath",
	"importSettings",

	// "focusInput", // kilocode_change
	"acceptInput",
	"profileButtonClicked", // kilocode_change
	"helpButtonClicked", // kilocode_change
	"focusChatInput", // kilocode_change
	"importSettings", // kilocode_change
	"exportSettings", // kilocode_change
	"generateTerminalCommand", // kilocode_change
	"handleExternalUri", // kilocode_change - for JetBrains plugin URL forwarding
	"focusPanel",
	"toggleAutoApprove",
] as const

export type CommandId = (typeof commandIds)[number]

/**
 * Language
 */

export const languages = [
	"en",
	"ru",
] as const

export const languagesSchema = z.enum(languages)

export type Language = z.infer<typeof languagesSchema>

export const isLanguage = (value: string): value is Language => languages.includes(value as Language)
