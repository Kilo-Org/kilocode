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
	formatDate,
	formatTime,
}
