/**
 * User management utilities
 */

// Types
export interface User {
	id: string
	username: string
	email: string
	isActive: boolean
	createdAt: Date
}

export interface UserPreferences {
	theme: "light" | "dark"
	notifications: boolean
	language: string
}

// Constants
export const DEFAULT_USER_PREFERENCES: UserPreferences = {
	theme: "light",
	notifications: true,
	language: "en-US",
}

// Deprecated - will be removed
export const LEGACY_USER_ROLES = ["admin", "user", "guest"]

/**
 * Creates a new user with default preferences
 * @param username The username
 * @param email The email address
 * @returns A new user object
 */
export function createUser(username: string, email: string): User {
	return {
		id: generateUserId(),
		username,
		email,
		isActive: true,
		createdAt: new Date(),
	}
}

/**
 * Generates a unique user ID
 * @returns A unique ID string
 */
function generateUserId(): string {
	return Math.random().toString(36).substring(2, 15)
}

/**
 * Validates a user object
 * @param user The user to validate
 * @returns True if the user is valid
 */
export function validateUser(user: User): boolean {
	if (!user.id || !user.username || !user.email) {
		return false
	}

	return isValidEmail(user.email)
}

/**
 * Checks if an email is valid
 * @param email The email to validate
 * @returns True if the email is valid
 */
function isValidEmail(email: string): boolean {
	const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
	return emailRegex.test(email)
}

/**
 * Formats user data for display
 * @param user The user to format
 * @returns Formatted user string
 */
export function formatUserData(user: User): string {
	return `${user.username} (${user.email})`
}

// Export default object
export default {
	createUser,
	validateUser,
	formatUserData,
	DEFAULT_USER_PREFERENCES,
	LEGACY_USER_ROLES,
}
