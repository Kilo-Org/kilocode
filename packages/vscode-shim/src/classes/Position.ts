import type { IPosition } from "../types.js"

/**
 * Represents a position in a text document
 *
 * A position is defined by a zero-based line number and a zero-based character offset.
 * This class is immutable - all methods that modify the position return a new instance.
 *
 * @example
 * ```typescript
 * const pos = new Position(5, 10) // Line 5, character 10
 * const next = pos.translate(1, 0)  // Line 6, character 10
 * ```
 */
export class Position implements IPosition {
	/**
	 * The zero-based line number
	 */
	public readonly line: number

	/**
	 * The zero-based character offset
	 */
	public readonly character: number

	/**
	 * Create a new Position
	 *
	 * @param line - The zero-based line number
	 * @param character - The zero-based character offset
	 */
	constructor(line: number, character: number) {
		if (line < 0) {
			throw new Error("Line number must be non-negative")
		}
		if (character < 0) {
			throw new Error("Character offset must be non-negative")
		}
		this.line = line
		this.character = character
	}

	/**
	 * Check if this position is equal to another position
	 */
	isEqual(other: IPosition): boolean {
		return this.line === other.line && this.character === other.character
	}

	/**
	 * Check if this position is before another position
	 */
	isBefore(other: IPosition): boolean {
		if (this.line < other.line) {
			return true
		}
		if (this.line === other.line) {
			return this.character < other.character
		}
		return false
	}

	/**
	 * Check if this position is before or equal to another position
	 */
	isBeforeOrEqual(other: IPosition): boolean {
		return this.isBefore(other) || this.isEqual(other)
	}

	/**
	 * Check if this position is after another position
	 */
	isAfter(other: IPosition): boolean {
		return !this.isBeforeOrEqual(other)
	}

	/**
	 * Check if this position is after or equal to another position
	 */
	isAfterOrEqual(other: IPosition): boolean {
		return !this.isBefore(other)
	}

	/**
	 * Compare this position to another
	 *
	 * @returns -1 if this position is before, 0 if equal, 1 if after
	 */
	compareTo(other: IPosition): number {
		if (this.line < other.line) {
			return -1
		}
		if (this.line > other.line) {
			return 1
		}
		if (this.character < other.character) {
			return -1
		}
		if (this.character > other.character) {
			return 1
		}
		return 0
	}

	/**
	 * Create a new position relative to this position
	 *
	 * @param lineDelta - The line delta (default: 0)
	 * @param characterDelta - The character delta (default: 0)
	 * @returns A new Position
	 */
	translate(lineDelta?: number, characterDelta?: number): Position
	translate(change: { lineDelta?: number; characterDelta?: number }): Position
	translate(
		lineDeltaOrChange?: number | { lineDelta?: number; characterDelta?: number },
		characterDelta?: number,
	): Position {
		if (typeof lineDeltaOrChange === "object") {
			return new Position(
				this.line + (lineDeltaOrChange.lineDelta || 0),
				this.character + (lineDeltaOrChange.characterDelta || 0),
			)
		}
		return new Position(this.line + (lineDeltaOrChange || 0), this.character + (characterDelta || 0))
	}

	/**
	 * Create a new position with changed line or character
	 *
	 * @param line - The new line number (or undefined to keep current)
	 * @param character - The new character offset (or undefined to keep current)
	 * @returns A new Position
	 */
	with(line?: number, character?: number): Position
	with(change: { line?: number; character?: number }): Position
	with(lineOrChange?: number | { line?: number; character?: number }, character?: number): Position {
		if (typeof lineOrChange === "object") {
			return new Position(
				lineOrChange.line !== undefined ? lineOrChange.line : this.line,
				lineOrChange.character !== undefined ? lineOrChange.character : this.character,
			)
		}
		return new Position(
			lineOrChange !== undefined ? lineOrChange : this.line,
			character !== undefined ? character : this.character,
		)
	}
}
