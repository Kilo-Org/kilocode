const Range = require('./Range')
const Position = require('./Position')

/**
 * Mock implementation of vscode.Selection
 * Extends Range with anchor and active position concepts
 */
class Selection extends Range {
    constructor(anchorLine, anchorCharacter, activeLine, activeCharacter) {
        // Handle different constructor signatures
        if (arguments.length === 2 && anchorLine instanceof Position && anchorCharacter instanceof Position) {
            // Selection(anchor: Position, active: Position)
            const anchor = anchorLine
            const active = anchorCharacter

            super(
                anchor.isBefore(active) ? anchor : active,
                anchor.isBefore(active) ? active : anchor
            )

            this.anchor = anchor
            this.active = active
        } else if (arguments.length === 4) {
            // Selection(anchorLine: number, anchorCharacter: number, activeLine: number, activeCharacter: number)
            const anchor = new Position(anchorLine, anchorCharacter)
            const active = new Position(activeLine, activeCharacter)

            super(
                anchor.isBefore(active) ? anchor : active,
                anchor.isBefore(active) ? active : anchor
            )

            this.anchor = anchor
            this.active = active
        } else {
            throw new Error('Selection constructor requires either 2 Position arguments or 4 number arguments')
        }
    }

    /**
     * Check if selection is reversed (active position before anchor)
     */
    get isReversed() {
        return this.active.isBefore(this.anchor)
    }

    /**
     * Create a new selection with updated anchor and active positions
     */
    with(anchor = this.anchor, active = this.active) {
        return new Selection(anchor, active)
    }

    toString() {
        return `Selection(anchor: ${this.anchor.toString()}, active: ${this.active.toString()})`
    }
}

module.exports = Selection