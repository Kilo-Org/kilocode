import { Position } from "./Position.js"
import type { IRange, IPosition } from "../types.js"

/**
 * Represents a range in a text document
 *
 * A range is defined by two positions: a start and an end position.
 * This class is immutable - all methods that modify the range return a new instance.
 *
 * @example
 * ```typescript
 * // Create a range from line 0 to line 5
 * const range = new Range(
 *   new Position(0, 0),
 *   new Position(5, 10)
 * )
 *
 * // Or use the overload with line/character numbers
 * const range2 = new Range(0, 0, 5, 10)
 * ```
 */
export class Range implements IRange {
	public readonly start: Position
	public readonly end: Position

	/**
	 * Create a new Range
	 *
	 * @param start - The start position
	 * @param end - The end position
	 */
	constructor(start: IPosition, end: IPosition)
	/**
	 * Create a new Range from line and character numbers
	 *
	 * @param startLine - The start line number
	 * @param startCharacter - The start character offset
	 * @param endLine - The end line number
	 * @param endCharacter - The end character offset
	 */
	constructor(startLine: number, startCharacter: number, endLine: number, endCharacter: number)
	constructor(
		startOrStartLine: IPosition | number,
		endOrStartCharacter: IPosition | number,
		endLine?: number,
		endCharacter?: number,
	) {
		if (typeof startOrStartLine === "number") {
			this.start = new Position(startOrStartLine, endOrStartCharacter as number)
			this.end = new Position(endLine!, endCharacter!)
		} else {
			this.start = startOrStartLine as Position
			this.end = endOrStartCharacter as Position
		}
	}

	/**
	 * Check if this range is empty (start equals end)
	 */
	get isEmpty(): boolean {
		return this.start.isEqual(this.end)
	}

	/**
	 * Check if this range is on a single line
	 */
	get isSingleLine(): boolean {
		return this.start.line === this.end.line
	}

	/**
	 * Check if this range contains a position or range
	 *
	 * @param positionOrRange - The position or range to check
	 * @returns true if the position/range is within this range
	 */
	contains(positionOrRange: IPosition | IRange): boolean {
		if ("start" in positionOrRange && "end" in positionOrRange) {
			// It's a range
			return this.contains(positionOrRange.start) && this.contains(positionOrRange.end)
		}
		// It's a position
		return positionOrRange.isAfterOrEqual(this.start) && positionOrRange.isBeforeOrEqual(this.end)
	}

	/**
	 * Check if this range is equal to another range
	 */
	isEqual(other: IRange): boolean {
		return this.start.isEqual(other.start) && this.end.isEqual(other.end)
	}

	/**
	 * Get the intersection of this range with another range
	 *
	 * @param other - The other range
	 * @returns The intersection range, or undefined if they don't intersect
	 */
	intersection(other: IRange): Range | undefined {
		const start = this.start.isAfter(other.start) ? this.start : other.start
		const end = this.end.isBefore(other.end) ? this.end : other.end
		if (start.isAfter(end)) {
			return undefined
		}
		return new Range(start, end)
	}

	/**
	 * Get the union of this range with another range
	 *
	 * @param other - The other range
	 * @returns A new range that spans both ranges
	 */
	union(other: IRange): Range {
		const start = this.start.isBefore(other.start) ? this.start : other.start
		const end = this.end.isAfter(other.end) ? this.end : other.end
		return new Range(start, end)
	}

	/**
	 * Create a new range with modified start or end positions
	 *
	 * @param start - The new start position (or undefined to keep current)
	 * @param end - The new end position (or undefined to keep current)
	 * @returns A new Range
	 */
	with(start?: IPosition, end?: IPosition): Range
	with(change: { start?: IPosition; end?: IPosition }): Range
	with(startOrChange?: IPosition | { start?: IPosition; end?: IPosition }, end?: IPosition): Range {
		// Check if it's a change object (has start or end property, but not line/character like a Position)
		if (startOrChange && typeof startOrChange === "object" && !("line" in startOrChange)) {
			const change = startOrChange as { start?: IPosition; end?: IPosition }
			return new Range(change.start || this.start, change.end || this.end)
		}
		return new Range((startOrChange as IPosition) || this.start, end || this.end)
	}
}
