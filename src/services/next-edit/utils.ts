/**
 * Utility functions for Next Edit feature
 *
 * This file provides helper functions for common operations like UUID generation,
 * validation, and file path formatting.
 */

import { v4 as uuidv4 } from "uuid"

// ============================================================================
// UUID Functions
// ============================================================================

/**
 * Generates a new UUID v4
 *
 * @returns A new UUID v4 string
 *
 * @example
 * ```typescript
 * const sessionId = generateUUID();
 * console.log(sessionId); // '550e8400-e29b-41d4-a716-446655440000'
 * ```
 */
export function generateUUID(): string {
	return uuidv4()
}

/**
 * Validates if a string is a valid UUID v4
 *
 * @param uuid - The UUID string to validate
 * @returns true if the UUID is valid, false otherwise
 *
 * @example
 * ```typescript
 * validateUUID('550e8400-e29b-41d4-a716-446655440000'); // true
 * validateUUID('invalid-uuid'); // false
 * ```
 */
export function validateUUID(uuid: string): boolean {
	const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
	return uuidRegex.test(uuid)
}

// ============================================================================
// File Path Functions
// ============================================================================

/**
 * Formats a file path for display purposes
 *
 * This function normalizes path separators and makes the path
 * more readable for UI display.
 *
 * @param filePath - The file path to format
 * @returns The formatted file path
 *
 * @example
 * ```typescript
 * formatFilePath('/Users/project/src/services/next-edit/types.ts');
 * // Returns: 'src/services/next-edit/types.ts' (relative to workspace)
 * ```
 */
export function formatFilePath(filePath: string): string {
	// Normalize path separators to forward slashes
	const normalized = filePath.replace(/\\/g, "/")

	// Remove leading slash if present
	const withoutLeadingSlash = normalized.startsWith("/") ? normalized.slice(1) : normalized

	return withoutLeadingSlash
}

/**
 * Extracts the file name from a file path
 *
 * @param filePath - The file path
 * @returns The file name with extension
 *
 * @example
 * ```typescript
 * getFileName('/Users/project/src/services/next-edit/types.ts');
 * // Returns: 'types.ts'
 * ```
 */
export function getFileName(filePath: string): string {
	const parts = filePath.split(/[/\\]/)
	return parts[parts.length - 1] || ""
}

/**
 * Extracts the file extension from a file path
 *
 * @param filePath - The file path
 * @returns The file extension without the dot (e.g., 'ts', 'js')
 *
 * @example
 * ```typescript
 * getFileExtension('/Users/project/src/services/next-edit/types.ts');
 * // Returns: 'ts'
 * ```
 */
export function getFileExtension(filePath: string): string {
	const fileName = getFileName(filePath)
	const lastDotIndex = fileName.lastIndexOf(".")
	return lastDotIndex > 0 ? fileName.slice(lastDotIndex + 1) : ""
}

// ============================================================================
// Date Functions
// ============================================================================

/**
 * Formats a date as an ISO string
 *
 * @param date - The date to format
 * @returns ISO formatted date string
 *
 * @example
 * ```typescript
 * formatDateISO(new Date());
 * // Returns: '2024-01-13T20:55:00.000Z'
 * ```
 */
export function formatDateISO(date: Date): string {
	return date.toISOString()
}

/**
 * Creates a date from an ISO string
 *
 * @param isoString - The ISO formatted date string
 * @returns Date object
 *
 * @example
 * ```typescript
 * parseDateISO('2024-01-13T20:55:00.000Z');
 * // Returns: Date object
 * ```
 */
export function parseDateISO(isoString: string): Date {
	return new Date(isoString)
}

// ============================================================================
// Array Functions
// ============================================================================

/**
 * Checks if two arrays have any common elements
 *
 * @param arr1 - First array
 * @param arr2 - Second array
 * @returns true if arrays share at least one element
 *
 * @example
 * ```typescript
 * arraysIntersect(['a', 'b'], ['b', 'c']); // true
 * arraysIntersect(['a', 'b'], ['c', 'd']); // false
 * ```
 */
export function arraysIntersect<T>(arr1: T[], arr2: T[]): boolean {
	return arr1.some((item) => arr2.includes(item))
}

/**
 * Returns the difference between two arrays (elements in arr1 not in arr2)
 *
 * @param arr1 - Source array
 * @param arr2 - Array to subtract
 * @returns Array of elements in arr1 that are not in arr2
 *
 * @example
 * ```typescript
 * arrayDifference(['a', 'b', 'c'], ['b']); // ['a', 'c']
 * ```
 */
export function arrayDifference<T>(arr1: T[], arr2: T[]): T[] {
	return arr1.filter((item) => !arr2.includes(item))
}

// ============================================================================
// Validation Functions
// ============================================================================

/**
 * Validates that a string is not empty or whitespace
 *
 * @param value - The string to validate
 * @returns true if the string is not empty or whitespace
 *
 * @example
 * ```typescript
 * isNonEmptyString('hello'); // true
 * isNonEmptyString('   '); // false
 * isNonEmptyString(''); // false
 * ```
 */
export function isNonEmptyString(value: string): boolean {
	return typeof value === "string" && value.trim().length > 0
}

/**
 * Validates that a number is within a specified range
 *
 * @param value - The number to validate
 * @param min - Minimum value (inclusive)
 * @param max - Maximum value (inclusive)
 * @returns true if the number is within the range
 *
 * @example
 * ```typescript
 * isInRange(5, 0, 10); // true
 * isInRange(15, 0, 10); // false
 * ```
 */
export function isInRange(value: number, min: number, max: number): boolean {
	return value >= min && value <= max
}

/**
 * Validates that line numbers are in correct order
 *
 * @param lineStart - Starting line number
 * @param lineEnd - Ending line number
 * @returns true if lineEnd >= lineStart
 *
 * @example
 * ```typescript
 * isValidLineRange(1, 5); // true
 * isValidLineRange(5, 1); // false
 * ```
 */
export function isValidLineRange(lineStart: number, lineEnd: number): boolean {
	return lineEnd >= lineStart && lineStart >= 1
}
