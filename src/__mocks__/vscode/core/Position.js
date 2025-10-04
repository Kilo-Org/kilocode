/**
 * Mock implementation of vscode.Position
 * Full API implementation with validation and comparison methods
 */
class Position {
    constructor(line, character) {
        if (typeof line !== 'number' || typeof character !== 'number') {
            throw new TypeError('Position constructor requires line and character to be numbers')
        }
        if (line < 0 || character < 0) {
            throw new Error('Position line and character must be non-negative')
        }
        this.line = Math.max(0, Math.floor(line))
        this.character = Math.max(0, Math.floor(character))
    }

    /**
     * Check if this position is before another position
     */
    isBefore(other) {
        if (this.line < other.line) return true
        if (this.line > other.line) return false
        return this.character < other.character
    }

    /**
     * Check if this position is before or equal to another position
     */
    isBeforeOrEqual(other) {
        return this.isBefore(other) || this.isEqual(other)
    }

    /**
     * Check if this position is after another position
     */
    isAfter(other) {
        return !this.isBeforeOrEqual(other)
    }

    /**
     * Check if this position is after or equal to another position
     */
    isAfterOrEqual(other) {
        return !this.isBefore(other)
    }

    /**
     * Check if this position equals another position
     */
    isEqual(other) {
        return this.line === other.line && this.character === other.character
    }

    /**
     * Compare this position to another (-1, 0, 1)
     */
    compareTo(other) {
        if (this.isBefore(other)) return -1
        if (this.isAfter(other)) return 1
        return 0
    }

    /**
     * Create a new position relative to this one
     */
    translate(lineDelta = 0, characterDelta = 0) {
        return new Position(this.line + lineDelta, this.character + characterDelta)
    }

    /**
     * Create a new position with updated line/character
     */
    with(line = this.line, character = this.character) {
        return new Position(line, character)
    }

    toString() {
        return `Position(${this.line}, ${this.character})`
    }
}

module.exports = Position