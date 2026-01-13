/**
 * Tool parameter type definitions for native protocol
 */

export interface LineRange {
	start: number
	end: number
}

export interface FileEntry {
	path: string
	lineRanges?: LineRange[]
}

export interface Coordinate {
	x: number
	y: number
}

export interface Size {
	width: number
	height: number
}

export interface BrowserActionParams {
	action: "launch" | "click" | "hover" | "type" | "scroll_down" | "scroll_up" | "resize" | "close" | "screenshot"
	url?: string
	coordinate?: Coordinate
	size?: Size
	text?: string
	path?: string
}

export interface GenerateImageParams {
	prompt: string
	path: string
	image?: string
}
