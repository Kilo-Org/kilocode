import { Range } from "./Range.js"
import { Position } from "./Position.js"
import type { ISelection, IPosition } from "../types.js"

/**
 * Represents a text selection in an editor
 *
 * A selection extends Range with anchor and active positions.
 * The anchor is where the selection starts, and the active is where it ends.
 * The selection can be reversed if the active position is before the anchor.
 *
 * @example
 * ```typescript
 * // Create a selection from position 0,0 to 5,10
 * const selection = new Selection(
 *   new Position(0, 0),
 *   new Position(5, 10)
 * )
 *
 * console.log(selection.isReversed) // false
 * ```
 */
export class Selection extends Range implements ISelection {
	/**
	 * The anchor position (where the selection started)
	 */
	public readonly anchor: Position

	/**
	 * The active position (where the selection currently ends)
	 */
	public readonly active: Position

	/**
	 * Create a new Selection
	 *
	 * @param anchor - The anchor position
	 * @param active - The active position
	 */
	constructor(anchor: IPosition, active: IPosition)
	/**
	 * Create a new Selection from line and character numbers
	 *
	 * @param anchorLine - The anchor line number
	 * @param anchorCharacter - The anchor character offset
	 * @param activeLine - The active line number
	 * @param activeCharacter - The active character offset
	 */
	constructor(anchorLine: number, anchorCharacter: number, activeLine: number, activeCharacter: number)
	constructor(
		anchorOrAnchorLine: IPosition | number,
		activeOrAnchorCharacter: IPosition | number,
		activeLine?: number,
		activeCharacter?: number,
	) {
		let anchor: Position
		let active: Position

		if (typeof anchorOrAnchorLine === "number") {
			anchor = new Position(anchorOrAnchorLine, activeOrAnchorCharacter as number)
			active = new Position(activeLine!, activeCharacter!)
		} else {
			anchor = anchorOrAnchorLine as Position
			active = activeOrAnchorCharacter as Position
		}

		super(anchor, active)
		this.anchor = anchor
		this.active = active
	}

	/**
	 * Check if the selection is reversed
	 * A reversed selection has the active position before the anchor position
	 */
	get isReversed(): boolean {
		return this.anchor.isAfter(this.active)
	}
}
