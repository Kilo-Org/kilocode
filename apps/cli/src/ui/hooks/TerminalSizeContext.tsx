/**
 * TerminalSizeContext - Provides terminal dimensions via React Context
 * This ensures only one instance of useTerminalSize exists in the app
 */

import { createContext, useContext, ReactNode } from "react"
import { useTerminalSize as useTerminalSizeHook } from "./useTerminalSize.js"

interface TerminalSizeContextValue {
	columns: number
	rows: number
}

const TerminalSizeContext = createContext<TerminalSizeContextValue | null>(null)

interface TerminalSizeProviderProps {
	children: ReactNode
}

/**
 * Provider component that wraps the app and provides terminal size to all children
 */
export function TerminalSizeProvider({ children }: TerminalSizeProviderProps) {
	const size = useTerminalSizeHook()
	return <TerminalSizeContext.Provider value={size}>{children}</TerminalSizeContext.Provider>
}

/**
 * Hook to access terminal size from context
 * Must be used within a TerminalSizeProvider
 */
export function useTerminalSize(): TerminalSizeContextValue {
	const context = useContext(TerminalSizeContext)
	if (!context) {
		throw new Error("useTerminalSize must be used within a TerminalSizeProvider")
	}
	return context
}
