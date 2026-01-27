import { Tree } from "web-tree-sitter"
import { Range } from "../../.."

export interface TypeSpanAndSourceFile {
	typeSpan: string
	sourceFile: string
}

export interface TypeSpanAndSourceFileAndAst extends TypeSpanAndSourceFile {
	ast: Tree
}

export interface HoleContext {
	fullHoverResult: string
	functionName: string
	functionTypeSpan: string
	returnTypeIsAny: boolean
	range: Range
	source: string
}

export type RelevantTypes = Map<string, TypeSpanAndSourceFileAndAst>
export type RelevantHeaders = Set<TypeSpanAndSourceFile>

type Filepath = string
type RelevantType = string
type RelevantHeader = string

export interface StaticContext {
	holeType: string
	relevantTypes: Map<Filepath, RelevantType[]>
	relevantHeaders: Map<Filepath, RelevantHeader[]>
}
