/**
 * Editor-related interfaces for VSCode API
 */

import type { Range } from "../classes/Range.js"
import type { Position } from "../classes/Position.js"
import type { Selection } from "../classes/Selection.js"
import type { Uri } from "../classes/Uri.js"
import type { ThemeColor } from "../classes/Additional.js"
import type {
	Thenable,
	ViewColumn,
	TextEditorRevealType,
	EndOfLine,
	DecorationRangeBehavior,
	OverviewRulerLane,
	TextEditorOptions,
} from "../types.js"
import type { TextDocument } from "./document.js"
import type { Disposable } from "../types.js"

/**
 * Represents a text editor in VSCode
 */
export interface TextEditor {
	document: TextDocument
	selection: Selection
	selections: Selection[]
	visibleRanges: Range[]
	options: TextEditorOptions
	viewColumn?: ViewColumn
	edit(callback: (editBuilder: TextEditorEdit) => void): Thenable<boolean>
	insertSnippet(
		snippet: unknown,
		location?: Position | Range | readonly Position[] | readonly Range[],
	): Thenable<boolean>
	setDecorations(decorationType: TextEditorDecorationType, rangesOrOptions: readonly Range[]): void
	revealRange(range: Range, revealType?: TextEditorRevealType): void
	show(column?: ViewColumn): void
	hide(): void
}

/**
 * Builder for text editor edits
 */
export interface TextEditorEdit {
	replace(location: Position | Range | Selection, value: string): void
	insert(location: Position, value: string): void
	delete(location: Range | Selection): void
	setEndOfLine(endOfLine: EndOfLine): void
}

/**
 * Event fired when text editor selection changes
 */
export interface TextEditorSelectionChangeEvent {
	textEditor: TextEditor
	selections: readonly Selection[]
	kind?: number
}

/**
 * Options for showing a text document
 */
export interface TextDocumentShowOptions {
	viewColumn?: ViewColumn
	preserveFocus?: boolean
	preview?: boolean
	selection?: Range
}

/**
 * Options for rendering decorations
 */
export interface DecorationRenderOptions {
	backgroundColor?: string | ThemeColor
	border?: string
	borderColor?: string | ThemeColor
	borderRadius?: string
	borderSpacing?: string
	borderStyle?: string
	borderWidth?: string
	color?: string | ThemeColor
	cursor?: string
	fontStyle?: string
	fontWeight?: string
	gutterIconPath?: string | Uri
	gutterIconSize?: string
	isWholeLine?: boolean
	letterSpacing?: string
	opacity?: string
	outline?: string
	outlineColor?: string | ThemeColor
	outlineStyle?: string
	outlineWidth?: string
	overviewRulerColor?: string | ThemeColor
	overviewRulerLane?: OverviewRulerLane
	rangeBehavior?: DecorationRangeBehavior
	textDecoration?: string
}

/**
 * Text editor decoration type interface
 */
export interface TextEditorDecorationType extends Disposable {
	key: string
}
