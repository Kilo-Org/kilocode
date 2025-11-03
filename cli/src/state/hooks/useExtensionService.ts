/**
 * Hook for accessing and managing the ExtensionService
 * Provides access to service instance, readiness state, and lifecycle management
 */

import { useAtom, useAtomValue, useSetAtom } from "jotai"
import { useMemo, useCallback } from "react"
import type { ExtensionService } from "../../services/extension.js"
import type { ExtensionAPI } from "../../host/ExtensionHost.js"
import type { MessageBridge } from "../../communication/ipc.js"
import {
	extensionServiceAtom,
	isServiceReadyAtom,
	serviceErrorAtom,
	isInitializingAtom,
	extensionAPIAtom,
	messageBridgeAtom,
	isServiceDisposedAtom,
	setExtensionServiceAtom,
	setServiceReadyAtom,
	setServiceErrorAtom,
	setIsInitializingAtom,
} from "../atoms/service.js"

/**
 * Return type for useExtensionService hook
 */
export interface UseExtensionServiceReturn {
	/** The ExtensionService instance (null if not set) */
	service: ExtensionService | null
	/** Whether the service is ready for use */
	isReady: boolean
	/** Whether the service is currently initializing */
	isInitializing: boolean
	/** Whether the service has been disposed */
	isDisposed: boolean
	/** Current service error (null if no error) */
	error: Error | null
	/** The ExtensionAPI instance (null if service not ready) */
	api: ExtensionAPI | null
	/** The MessageBridge instance (null if service not available) */
	messageBridge: MessageBridge | null
	/** Set the ExtensionService instance */
	setService: (service: ExtensionService | null) => void
	/** Initialize the service */
	initialize: () => Promise<void>
	/** Dispose the service */
	dispose: () => Promise<void>
	/** Mark service as ready */
	markReady: (ready: boolean) => void
	/** Set a service error */
	setError: (error: Error | null) => void
}

/**
 * Hook for accessing and managing the ExtensionService
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const { service, isReady, initialize, error } = useExtensionService()
 *
 *   useEffect(() => {
 *     if (!service) {
 *       const newService = createExtensionService()
 *       setService(newService)
 *       initialize()
 *     }
 *   }, [])
 *
 *   if (error) return <div>Error: {error.message}</div>
 *   if (!isReady) return <div>Loading...</div>
 *
 *   return <div>Service ready!</div>
 * }
 * ```
 */
export function useExtensionService(): UseExtensionServiceReturn {
	// Read atoms
	const [service] = useAtom(extensionServiceAtom)
	const isReady = useAtomValue(isServiceReadyAtom)
	const isInitializing = useAtomValue(isInitializingAtom)
	const isDisposed = useAtomValue(isServiceDisposedAtom)
	const error = useAtomValue(serviceErrorAtom)
	const api = useAtomValue(extensionAPIAtom)
	const messageBridge = useAtomValue(messageBridgeAtom)

	// Write atoms
	const setService = useSetAtom(setExtensionServiceAtom)
	const markReady = useSetAtom(setServiceReadyAtom)
	const setError = useSetAtom(setServiceErrorAtom)
	const setInitializing = useSetAtom(setIsInitializingAtom)

	/**
	 * Initialize the service
	 * Handles initialization state and errors
	 */
	const initialize = useCallback(async () => {
		if (!service) {
			const err = new Error("Cannot initialize: service not set")
			setError(err)
			throw err
		}

		if (isReady) {
			return
		}

		try {
			setInitializing(true)
			await service.initialize()
			markReady(true)
		} catch (err) {
			const error = err instanceof Error ? err : new Error(String(err))
			setError(error)
			throw error
		}
	}, [service, isReady, setInitializing, markReady, setError])

	/**
	 * Dispose the service
	 * Cleans up resources and resets state
	 */
	const dispose = useCallback(async () => {
		if (!service) {
			return
		}

		try {
			await service.dispose()
			markReady(false)
			setService(null)
		} catch (err) {
			const error = err instanceof Error ? err : new Error(String(err))
			setError(error)
			throw error
		}
	}, [service, markReady, setService, setError])

	// Memoize return value to prevent unnecessary re-renders
	return useMemo(
		() => ({
			service,
			isReady,
			isInitializing,
			isDisposed,
			error,
			api,
			messageBridge,
			setService,
			initialize,
			dispose,
			markReady,
			setError,
		}),
		[
			service,
			isReady,
			isInitializing,
			isDisposed,
			error,
			api,
			messageBridge,
			setService,
			initialize,
			dispose,
			markReady,
			setError,
		],
	)
}
