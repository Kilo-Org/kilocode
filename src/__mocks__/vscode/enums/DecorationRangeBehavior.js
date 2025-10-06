/**
 * Mock implementation of vscode.DecorationRangeBehavior enum
 * Describes the behavior of decorations when typing/editing at their edges
 */
const DecorationRangeBehavior = {
    /**
     * The decoration's range will be extended when edits occur at the start or end.
     */
    OpenOpen: 0,

    /**
     * The decoration's range will be extended when edits occur at the start, but not at the end.
     */
    ClosedClosed: 1,

    /**
     * The decoration's range will be extended when edits occur at the end, but not at the start.
     */
    OpenClosed: 2,

    /**
     * The decoration's range will not be extended when edits occur at the start or end.
     */
    ClosedOpen: 3
}

module.exports = DecorationRangeBehavior