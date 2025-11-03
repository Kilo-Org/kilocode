/**
 * Profile and balance state atoms for Kilocode user data
 */

import { atom } from "jotai"

/**
 * Profile data structure from Kilocode API
 */
export interface ProfileUser {
	name?: string
	email?: string
	image?: string
}

export interface UserOrganization {
	id: string
	name: string
	role: string
}

export interface ProfileData {
	user?: ProfileUser
	organizations?: UserOrganization[]
}

export interface BalanceData {
	balance: number
}

/**
 * Atom to hold profile data
 */
export const profileDataAtom = atom<ProfileData | null>(null)

/**
 * Atom to hold balance data
 */
export const balanceDataAtom = atom<BalanceData | null>(null)

/**
 * Atom to track profile loading state
 */
export const profileLoadingAtom = atom<boolean>(false)

/**
 * Atom to track balance loading state
 */
export const balanceLoadingAtom = atom<boolean>(false)

/**
 * Atom to store profile errors
 */
export const profileErrorAtom = atom<string | null>(null)

/**
 * Atom to store balance errors
 */
export const balanceErrorAtom = atom<string | null>(null)

/**
 * Derived atom to get current organization details
 * Takes the organizationId as a parameter to avoid circular dependencies
 * Usage: get(getCurrentOrganization(organizationId))
 */
export const getCurrentOrganization = (organizationId: string | undefined) =>
	atom((get) => {
		const profileData = get(profileDataAtom)

		if (!profileData?.organizations || !organizationId) {
			return null
		}

		return profileData.organizations.find((org) => org.id === organizationId) || null
	})

/**
 * Derived atom to check if user has any organizations
 */
export const hasOrganizationsAtom = atom((get) => {
	const profileData = get(profileDataAtom)
	return (profileData?.organizations?.length ?? 0) > 0
})

/**
 * Action atom to update profile data
 */
export const updateProfileDataAtom = atom(null, (get, set, data: ProfileData | null) => {
	set(profileDataAtom, data)
	set(profileErrorAtom, null)
})

/**
 * Action atom to update balance data
 */
export const updateBalanceDataAtom = atom(null, (get, set, data: BalanceData | null) => {
	set(balanceDataAtom, data)
	set(balanceErrorAtom, null)
})

/**
 * Action atom to set profile loading state
 */
export const setProfileLoadingAtom = atom(null, (get, set, loading: boolean) => {
	set(profileLoadingAtom, loading)
	if (loading) {
		set(profileErrorAtom, null)
	}
})

/**
 * Action atom to set balance loading state
 */
export const setBalanceLoadingAtom = atom(null, (get, set, loading: boolean) => {
	set(balanceLoadingAtom, loading)
	if (loading) {
		set(balanceErrorAtom, null)
	}
})

/**
 * Action atom to set profile error
 */
export const setProfileErrorAtom = atom(null, (get, set, error: string | null) => {
	set(profileErrorAtom, error)
	set(profileLoadingAtom, false)
})

/**
 * Action atom to set balance error
 */
export const setBalanceErrorAtom = atom(null, (get, set, error: string | null) => {
	set(balanceErrorAtom, error)
	set(balanceLoadingAtom, false)
})

/**
 * Action atom to clear all profile data
 */
export const clearProfileDataAtom = atom(null, (get, set) => {
	set(profileDataAtom, null)
	set(balanceDataAtom, null)
	set(profileLoadingAtom, false)
	set(balanceLoadingAtom, false)
	set(profileErrorAtom, null)
	set(balanceErrorAtom, null)
})
