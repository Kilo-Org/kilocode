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

	// Using the moved function from target.ts
	return isValidEmail(user.email)
}

/**
 * Formats user data for display
 * @param user The user to format
 * @returns Formatted user string
 */
export function displayUserInfo(user: User): string {
	return `${user.username} (${user.email})`
}

// Import the moved function
import { isValidEmail } from "./target"

// Export default object
export default {
	createUser,
	validateUser,
	displayUserInfo,
	DEFAULT_USER_PREFERENCES,
}
