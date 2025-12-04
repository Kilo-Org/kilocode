/**
 * Hook for managing Kilocode profile and balance data
 */

import { useSetAtom, useAtomValue } from "jotai"
import { useCallback, useEffect, useRef } from "react"
import {
	profileDataAtom,
	balanceDataAtom,
	profileLoadingAtom,
	balanceLoadingAtom,
	profileErrorAtom,
	balanceErrorAtom,
	setProfileLoadingAtom,
	setBalanceLoadingAtom,
	setProfileErrorAtom,
	setBalanceErrorAtom,
	hasOrganizationsAtom,
	getCurrentOrganization,
	type ProfileData,
	type BalanceData,
} from "../atoms/profile.js"
import { providerAtom } from "../atoms/config.js"
import { useWebviewMessage } from "./useWebviewMessage.js"

/**
 * Return type for useProfile hook
 */
export interface UseProfileReturn {
	// Data
	profileData: ProfileData | null
	balanceData: BalanceData | null
	currentOrganization: ReturnType<typeof getCurrentOrganization> | null
	hasOrganizations: boolean

	// Loading states
	profileLoading: boolean
	balanceLoading: boolean

	// Errors
	profileError: string | null
	balanceError: string | null

	// Actions
	fetchProfile: () => Promise<void>
	fetchBalance: () => Promise<void>
	fetchAll: () => Promise<void>
}

/**
 * Hook for managing Kilocode profile and balance data
 *
 * Provides access to profile data, balance, organizations, and methods to fetch data.
 * Automatically handles loading states and errors.
 *
 */
export function useProfile(): UseProfileReturn {
	// Get atoms
	const profileData = useAtomValue(profileDataAtom)
	const balanceData = useAtomValue(balanceDataAtom)
	const profileLoading = useAtomValue(profileLoadingAtom)
	const balanceLoading = useAtomValue(balanceLoadingAtom)
	const profileError = useAtomValue(profileErrorAtom)
	const balanceError = useAtomValue(balanceErrorAtom)
	const hasOrganizations = useAtomValue(hasOrganizationsAtom)
	const currentProvider = useAtomValue(providerAtom)

	// Get action atoms
	const setProfileLoading = useSetAtom(setProfileLoadingAtom)
	const setBalanceLoading = useSetAtom(setBalanceLoadingAtom)
	const setProfileError = useSetAtom(setProfileErrorAtom)
	const setBalanceError = useSetAtom(setBalanceErrorAtom)

	// Get webview message sender
	const { sendMessage } = useWebviewMessage()

	// Get current organization
	const currentOrganization =
		currentProvider?.kilocodeOrganizationId && typeof currentProvider.kilocodeOrganizationId === "string"
			? getCurrentOrganization(currentProvider.kilocodeOrganizationId)
			: null

	/**
	 * Fetch profile data from the extension
	 */
	const fetchProfile = useCallback(async () => {
		setProfileLoading(true)
		try {
			await sendMessage({
				type: "fetchProfileDataRequest",
			})
		} catch (error) {
			setProfileError(error instanceof Error ? error.message : "Failed to fetch profile")
		}
	}, [sendMessage, setProfileLoading, setProfileError])

	/**
	 * Fetch balance data from the extension
	 */
	const fetchBalance = useCallback(async () => {
		setBalanceLoading(true)
		try {
			await sendMessage({
				type: "fetchBalanceDataRequest",
			})
		} catch (error) {
			setBalanceError(error instanceof Error ? error.message : "Failed to fetch balance")
		}
	}, [sendMessage, setBalanceLoading, setBalanceError])

	/**
	 * Fetch both profile and balance data
	 */
	const fetchAll = useCallback(async () => {
		await Promise.all([fetchProfile(), fetchBalance()])
	}, [fetchProfile, fetchBalance])

	// Track if initial fetch has been triggered
	const initialFetchTriggered = useRef(false)

	// Automatically fetch profile and balance data on mount if using Kilocode provider
	useEffect(() => {
		if (
			!initialFetchTriggered.current &&
			currentProvider?.provider === "kilocode" &&
			currentProvider?.kilocodeToken &&
			!profileData &&
			!profileLoading
		) {
			initialFetchTriggered.current = true
			fetchAll()
		}
	}, [currentProvider, profileData, profileLoading, fetchAll])

	return {
		// Data
		profileData,
		balanceData,
		currentOrganization,
		hasOrganizations,

		// Loading states
		profileLoading,
		balanceLoading,

		// Errors
		profileError,
		balanceError,

		// Actions
		fetchProfile,
		fetchBalance,
		fetchAll,
	}
}
