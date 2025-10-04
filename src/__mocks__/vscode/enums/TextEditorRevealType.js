/**
 * Mock implementation of vscode.TextEditorRevealType enum
 * Used for controlling how text is revealed in the editor
 */
const TextEditorRevealType = {
    /**
     * The range will be revealed with as little scrolling as possible.
     */
    Default: 0,

    /**
     * The range will always be revealed in the center of the viewport.
     */
    InCenter: 1,

    /**
     * If the range is outside the viewport, it will be revealed in the center of the viewport.
     * Otherwise, it will not be scrolled.
     */
    InCenterIfOutsideViewport: 2,

    /**
     * The range will always be revealed at the top of the viewport.
     */
    AtTop: 3
}

module.exports = TextEditorRevealType