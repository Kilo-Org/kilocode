export interface ParameterInformation {
  label: string | [number, number]
  documentation?: string
}

declare global {
  interface Window {
    ide?: "vscode"
    windowId: string
    serverUrl: string
    vscMachineId: string
    vscMediaUrl: string
    fullColorTheme?: {
      rules?: {
        token?: string
        foreground?: string
      }[]
    }
    colorThemeName?: string
    workspacePaths?: string[]
    postIntellijMessage?: (messageType: string, data: any, messageIde: string) => void
  }
}

export interface RangeInFile {
  filepath: string
  range: Range
}

export interface Location {
  filepath: string
  position: Position
}

export interface Range {
  start: Position
  end: Position
}

export interface Position {
  line: number
  character: number
}

export interface CompletionOptions extends BaseCompletionOptions {
  model: string
}

export type TextMessagePart = {
  type: "text"
  text: string
}

export type MessagePart = TextMessagePart

export type MessageContent = string | MessagePart[]

// IDE

export interface Disposable {
  dispose(): void
}

export interface IDE {
  getClipboardContent(): Promise<{ text: string; copiedAt: string }>

  getWorkspaceDirs(): Promise<string[]>

  readFile(fileUri: string): Promise<string>

  readRangeInFile(fileUri: string, range: Range): Promise<string>

  // LSP
  gotoDefinition(location: Location): Promise<RangeInFile[]>
  gotoTypeDefinition(location: Location): Promise<RangeInFile[]> // TODO: add to jetbrains
  getSignatureHelp(location: Location): Promise<SignatureHelp | null> // TODO: add to jetbrains

  // Callbacks
  onDidChangeActiveTextEditor(callback: (fileUri: string) => void): Disposable | void
}

export interface BaseCompletionOptions {
  temperature?: number
  topP?: number
  presencePenalty?: number
  frequencyPenalty?: number
  stop?: string[]
  maxTokens?: number
  raw?: boolean
  stream?: boolean
  reasoning?: boolean
  reasoningBudgetTokens?: number
  promptCaching?: boolean
}

// TODO: We should consider renaming this to AutocompleteOptions.
export interface TabAutocompleteOptions {
  disable: boolean
  maxPromptTokens: number
  debounceDelay: number
  modelTimeout: number
  maxSuffixPercentage: number
  prefixPercentage: number
  maxSnippetPercentage: number
  transform?: boolean
  multilineCompletions: "always" | "never" | "auto"
  slidingWindowPrefixPercentage: number
  slidingWindowSize: number
  useCache: boolean
  onlyMyCode: boolean
  useRecentlyEdited: boolean
  useRecentlyOpened: boolean
  disableInFiles?: string[]
  useImports?: boolean
  showWhateverWeHaveAtXMs?: number
  // true = enabled, false = disabled, number = enabled with priority
  experimental_includeClipboard: boolean | number
  experimental_includeRecentlyVisitedRanges: boolean | number
  experimental_includeRecentlyEditedRanges: boolean | number
  experimental_enableStaticContextualization: boolean
}

export interface RangeInFileWithContents {
  filepath: string
  range: {
    start: { line: number; character: number }
    end: { line: number; character: number }
  }
  contents: string
}

/**
 * Signature help represents the signature of something
 * callable. There can be multiple signatures but only one
 * active and only one active parameter.
 */
export interface SignatureHelp {
  /**
   * One or more signatures.
   */
  signatures: SignatureInformation[]

  /**
   * The active signature.
   */
  activeSignature: number

  /**
   * The active parameter of the active signature.
   */
  activeParameter: number
}

/**
 * Represents the signature of something callable. A signature
 * can have a label, like a function-name, a doc-comment, and
 * a set of parameters.
 */
interface SignatureInformation {
  /**
   * The label of this signature. Will be shown in
   * the UI.
   */
  label: string
  /**
   * The parameters of this signature.
   */
  parameters: ParameterInformation[]

  /**
   * The index of the active parameter.
   *
   * If provided, this is used in place of {@linkcode SignatureHelp.activeParameter}.
   */
  activeParameter?: number
}
