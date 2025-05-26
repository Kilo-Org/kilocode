/**
 * Utility functions for user validation and formatting
 */

// Helper functions for validation
export function isValidUsername(username: string): boolean {
	return username.length >= 3 && /^[a-zA-Z0-9_]+$/.test(username)
}

export function isValidPassword(password: string): boolean {
	// At least 8 characters, one uppercase, one lowercase, one number
	return password.length >= 8 && /[A-Z]/.test(password) && /[a-z]/.test(password) && /[0-9]/.test(password)
}

/**
 * Checks if an email is valid
 * @param email The email to validate
 * @returns True if the email is valid
 */
export function isValidEmail(email: string): boolean {
	const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
	return emailRegex.test(email)
}

// Helper functions for formatting
export function formatDate(date: Date): string {
	return date.toLocaleDateString()
}

export function formatTime(date: Date): string {
	return date.toLocaleTimeString()
}

// Export default object
export default {
	isValidUsername,
	isValidPassword,
	isValidEmail,
	formatDate,
	formatTime,
}
