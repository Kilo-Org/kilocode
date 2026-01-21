/**
 * Service-related Jotai atoms for managing ExtensionService instance and status
 */

import { atom } from "jotai"
import type { ExtensionService, ExtensionAPI, MessageBridge } from "../../services/extension.js"

/**
 * Atom to hold the ExtensionService instance
 * This is the core service that manages the extension host and message bridge
 */
export const extensionServiceAtom = atom<ExtensionService | null>(null)

/**
 * Atom to track if the service is ready (initialized and not disposed)
 */
export const isServiceReadyAtom = atom<boolean>(false)

/**
 * Atom to track service initialization errors
 */
export const serviceErrorAtom = atom<Error | null>(null)

/**
 * Atom to track if the service is currently initializing
 */
export const isInitializingAtom = atom<boolean>(false)

/**
 * Derived atom to get the ExtensionAPI from the service
 * Returns null if service is not ready or API is not available
 */
export const extensionAPIAtom = atom<ExtensionAPI | null>((get) => {
	const service = get(extensionServiceAtom)
	if (!service || !get(isServiceReadyAtom)) {
		return null
	}
	return service.getExtensionAPI()
})

/**
 * Derived atom to get the MessageBridge from the service
 * Returns null if service is not available
 */
export const messageBridgeAtom = atom<MessageBridge | null>((get) => {
	const service = get(extensionServiceAtom)
	if (!service) {
		return null
	}
	return service.getMessageBridge()
})

/**
 * Derived atom to check if the service is disposed
 */
export const isServiceDisposedAtom = atom<boolean>((get) => {
	const service = get(extensionServiceAtom)
	if (!service) {
		return true
	}
	return !service.isReady()
})

/**
 * Action atom to set the ExtensionService instance
 * This should be called once during application initialization
 */
export const setExtensionServiceAtom = atom(null, (get, set, service: ExtensionService | null) => {
	set(extensionServiceAtom, service)

	// Reset ready state when service changes
	if (!service) {
		set(isServiceReadyAtom, false)
		set(serviceErrorAtom, null)
	}
})

/**
 * Action atom to mark the service as ready
 * This should be called after successful initialization
 */
export const setServiceReadyAtom = atom(null, (get, set, ready: boolean) => {
	set(isServiceReadyAtom, ready)
	set(isInitializingAtom, false)

	// Clear error when service becomes ready
	if (ready) {
		set(serviceErrorAtom, null)
	}
})

/**
 * Action atom to set a service error
 * This should be called when initialization or operation fails
 */
export const setServiceErrorAtom = atom(null, (get, set, error: Error | null) => {
	set(serviceErrorAtom, error)
	set(isInitializingAtom, false)

	// Mark service as not ready when error occurs
	if (error) {
		set(isServiceReadyAtom, false)
	}
})

/**
 * Action atom to set initialization state
 */
export const setIsInitializingAtom = atom(null, (get, set, initializing: boolean) => {
	set(isInitializingAtom, initializing)
})
