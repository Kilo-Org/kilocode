import { VSCodeAPI } from "./api/VSCodeAPI"
import { FileSystemAdapter } from "./adapters/FileSystemAdapter"
import { UserInterfaceAdapter } from "./adapters/UserInterfaceAdapter"
import { EventEmitter } from "events"

const fileSystemAdapter = new FileSystemAdapter(process.cwd())
const userInterfaceAdapter = new UserInterfaceAdapter()
const vscodeAPI = new VSCodeAPI(fileSystemAdapter, userInterfaceAdapter)

export const workspace = vscodeAPI.workspace
export const window = vscodeAPI.window
export const commands = vscodeAPI.commands
export const languages = vscodeAPI.languages
export const env = vscodeAPI.env

export const Uri = VSCodeAPI.Uri
export const Disposable = VSCodeAPI.Disposable
export const RelativePattern = VSCodeAPI.RelativePattern

export { EventEmitter }
export enum FileType {
	Unknown = 0,
	File = 1,
	Directory = 2,
	SymbolicLink = 64,
}

export enum EndOfLine {
	LF = 1,
	CRLF = 2,
}

export enum StatusBarAlignment {
	Left = 1,
	Right = 2,
}

export enum ViewColumn {
	Active = -1,
	Beside = -2,
	One = 1,
	Two = 2,
	Three = 3,
	Four = 4,
	Five = 5,
	Six = 6,
	Seven = 7,
	Eight = 8,
	Nine = 9,
}

export enum ProgressLocation {
	SourceControl = 1,
	Window = 10,
	Notification = 15,
}

export enum UIKind {
	Desktop = 1,
	Web = 2,
}

export function createExtensionContext() {
	return vscodeAPI.createExtensionContext()
}
export default {
	workspace,
	window,
	commands,
	languages,
	env,
	Uri,
	Disposable,
	RelativePattern,
	EventEmitter,
	FileType,
	EndOfLine,
	StatusBarAlignment,
	ViewColumn,
	ProgressLocation,
	UIKind,
	createExtensionContext,
}
