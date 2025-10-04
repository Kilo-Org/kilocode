const Position = require('./Position')

/**
 * Mock implementation of vscode.Range
 * Represents a range between two positions with full validation
 */
class Range {
    constructor(startLine, startCharacter, endLine, endCharacter) {
        // Handle different constructor signatures
        if (arguments.length === 2 && startLine instanceof Position && startCharacter instanceof Position) {
            // Range(start: Position, end: Position)
            this.start = startLine
            this.end = startCharacter
        } else if (arguments.length === 4) {
            // Range(startLine: number, startCharacter: number, endLine: number, endCharacter: number)
            this.start = new Position(startLine, startCharacter)
            this.end = new Position(endLine, endCharacter)
        } else {
            throw new Error('Range constructor requires either 2 Position arguments or 4 number arguments')
        }

        // Validate that start comes before or equals end
        if (this.start.isAfter(this.end)) {
            throw new Error('Range start position must not be after end position')
        }
    }

    /**
     * Check if this range is empty (start equals end)
     */
    get isEmpty() {
        return this.start.isEqual(this.end)
    }

    /**
     * Check if this range spans only one line
     */
    get isSingleLine() {
        return this.start.line === this.end.line
    }

    /**
     * Check if this range contains a position or another range
     */
    contains(positionOrRange) {
        if (positionOrRange instanceof Position) {
            return (
                positionOrRange.isAfterOrEqual(this.start) &&
                positionOrRange.isBeforeOrEqual(this.end)
            )
        } else if (positionOrRange instanceof Range) {
            return this.contains(positionOrRange.start) && this.contains(positionOrRange.end)
        }
        return false
    }

    /**
     * Check if this range equals another range
     */
    isEqual(other) {
        return this.start.isEqual(other.start) && this.end.isEqual(other.end)
    }

    /**
     * Get intersection with another range
     */
    intersection(range) {
        const start = this.start.isAfter(range.start) ? this.start : range.start
        const end = this.end.isBefore(range.end) ? this.end : range.end

        if (start.isAfterOrEqual(end)) {
            return undefined // No intersection
        }

        return new Range(start, end)
    }

    /**
     * Get union with another range
     */
    union(other) {
        const start = this.start.isBefore(other.start) ? this.start : other.start
        const end = this.end.isAfter(other.end) ? this.end : other.end
        return new Range(start, end)
    }

    /**
     * Create a new range with different start/end positions
     */
    with(start = this.start, end = this.end) {
        return new Range(start, end)
    }

    toString() {
        return `Range(${this.start.toString()}, ${this.end.toString()})`
    }
}

module.exports = Range