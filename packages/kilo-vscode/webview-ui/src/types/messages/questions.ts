// Todo item
export interface TodoItem {
  id: string
  content: string
  status: "pending" | "in_progress" | "completed"
}

// Question types
export interface QuestionOption {
  label: string
  description: string
  mode?: string
  // Optional i18n keys — the backend fills these for strings it wants translated in the webview.
  // The canonical English `label` stays on the reply wire, so server-side matching is unaffected.
  labelKey?: string
  descriptionKey?: string
}

export interface QuestionInfo {
  question: string
  header: string
  options: QuestionOption[]
  multiple?: boolean
  custom?: boolean
  // Optional i18n keys for question text and header (see QuestionOption for details).
  questionKey?: string
  headerKey?: string
}

export interface QuestionRequest {
  id: string
  sessionID: string
  questions: QuestionInfo[]
  blocking?: boolean
  tool?: {
    messageID: string
    callID: string
  }
}

export interface SuggestionAction {
  label: string
  description?: string
  prompt: string
}

export interface SuggestionRequest {
  id: string
  sessionID: string
  text: string
  actions: SuggestionAction[]
  blocking?: boolean
  tool?: {
    messageID: string
    callID: string
  }
}
