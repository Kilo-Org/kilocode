/**
 * FileState Entity Enhancement
 *
 * Extends file state types for multi-file coordination
 */

import { FileState } from "./session-types"

/**
 * Enhanced file state with multi-file support
 */
export class FileStateEntity {
	/**
	 * Create new file state
	 */
	static create(
		filePath: string,
		hasUnsavedChanges: boolean = false,
		activeDiffCount: number = 0,
		lastSyncVersion: number = 1,
	): FileState {
		return {
			filePath,
			hasUnsavedChanges,
			activeDiffCount,
			lastSyncVersion,
		}
	}

	/**
	 * Update file state
	 */
	static update(fileState: FileState, updates: Partial<FileState>): FileState {
		return {
			...fileState,
			...updates,
		}
	}

	/**
	 * Increment diff count
	 */
	static incrementDiffCount(fileState: FileState): FileState {
		return {
			...fileState,
			activeDiffCount: fileState.activeDiffCount + 1,
			hasUnsavedChanges: true,
		}
	}

	/**
	 * Decrement diff count
	 */
	static decrementDiffCount(fileState: FileState): FileState {
		const newCount = Math.max(0, fileState.activeDiffCount - 1)
		return {
			...fileState,
			activeDiffCount: newCount,
			hasUnsavedChanges: newCount > 0,
		}
	}

	/**
	 * Clear diff count
	 */
	static clearDiffCount(fileState: FileState): FileState {
		return {
			...fileState,
			activeDiffCount: 0,
			hasUnsavedChanges: false,
		}
	}

	/**
	 * Update sync version
	 */
	static updateSyncVersion(fileState: FileState, newVersion: number): FileState {
		return {
			...fileState,
			lastSyncVersion: newVersion,
		}
	}

	/**
	 * Mark as saved
	 */
	static markAsSaved(fileState: FileState): FileState {
		return {
			...fileState,
			hasUnsavedChanges: false,
		}
	}

	/**
	 * Mark as unsaved
	 */
	static markAsUnsaved(fileState: FileState): FileState {
		return {
			...fileState,
			hasUnsavedChanges: true,
		}
	}

	/**
	 * Validate file state
	 */
	static validate(fileState: FileState): { isValid: boolean; errors: string[] } {
		const errors: string[] = []

		if (!fileState.filePath || fileState.filePath.trim() === "") {
			errors.push("File path is required")
		}

		if (typeof fileState.hasUnsavedChanges !== "boolean") {
			errors.push("Has unsaved changes must be a boolean")
		}

		if (typeof fileState.activeDiffCount !== "number" || fileState.activeDiffCount < 0) {
			errors.push("Active diff count must be a non-negative number")
		}

		if (typeof fileState.lastSyncVersion !== "number" || fileState.lastSyncVersion < 1) {
			errors.push("Last sync version must be a positive number")
		}

		return {
			isValid: errors.length === 0,
			errors,
		}
	}

	/**
	 * Get file state summary
	 */
	static getSummary(fileState: FileState): string {
		const status = fileState.hasUnsavedChanges ? "unsaved" : "saved"
		const diffs = fileState.activeDiffCount > 0 ? `${fileState.activeDiffCount} diffs` : "no diffs"

		return `${fileState.filePath} (${status}, ${diffs})`
	}

	/**
	 * Check if file needs attention
	 */
	static needsAttention(fileState: FileState): boolean {
		return fileState.hasUnsavedChanges || fileState.activeDiffCount > 0
	}

	/**
	 * Get file priority
	 */
	static getPriority(fileState: FileState): "high" | "medium" | "low" {
		if (fileState.activeDiffCount > 5) {
			return "high"
		} else if (fileState.activeDiffCount > 2) {
			return "medium"
		}
		return "low"
	}

	/**
	 * Merge file states
	 */
	static merge(base: FileState, update: Partial<FileState>): FileState {
		return {
			filePath: base.filePath,
			hasUnsavedChanges: update.hasUnsavedChanges ?? base.hasUnsavedChanges,
			activeDiffCount: update.activeDiffCount ?? base.activeDiffCount,
			lastSyncVersion: update.lastSyncVersion ?? base.lastSyncVersion,
		}
	}
}
