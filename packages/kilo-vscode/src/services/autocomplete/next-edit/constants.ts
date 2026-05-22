/**
 * Sentinel tokens used to template the prompt for Mercury Edit 2 via the
 * Inception `/v1/edit/completions` endpoint. The tag set is defined by the
 * model and must be reproduced verbatim — see
 * https://docs.inceptionlabs.ai/capabilities/next-edit
 */

export const MERCURY_RECENTLY_VIEWED_CODE_SNIPPETS_OPEN = "<|recently_viewed_code_snippets|>"
export const MERCURY_RECENTLY_VIEWED_CODE_SNIPPETS_CLOSE = "<|/recently_viewed_code_snippets|>"
export const MERCURY_RECENTLY_VIEWED_CODE_SNIPPET_OPEN = "<|recently_viewed_code_snippet|>"
export const MERCURY_RECENTLY_VIEWED_CODE_SNIPPET_CLOSE = "<|/recently_viewed_code_snippet|>"
export const MERCURY_CURRENT_FILE_CONTENT_OPEN = "<|current_file_content|>"
export const MERCURY_CURRENT_FILE_CONTENT_CLOSE = "<|/current_file_content|>"
export const MERCURY_CODE_TO_EDIT_OPEN = "<|code_to_edit|>"
export const MERCURY_CODE_TO_EDIT_CLOSE = "<|/code_to_edit|>"
export const MERCURY_EDIT_DIFF_HISTORY_OPEN = "<|edit_diff_history|>"
export const MERCURY_EDIT_DIFF_HISTORY_CLOSE = "<|/edit_diff_history|>"
export const MERCURY_CURSOR = "<|cursor|>"

export const MERCURY_EDIT_MODEL_ID = "mercury-edit-2"
export const INCEPTION_API_BASE_URL = "https://api.inceptionlabs.ai/v1"
export const INCEPTION_EDIT_PATH = "/edit/completions"

/** Token Mercury Edit uses to distinguish next-edit calls from regular chat. */
export const MERCURY_UNIQUE_TOKEN = "<|!@#IS_NEXT_EDIT!@#|>"

// Note: the /v1/edit/completions endpoint accepts only a `role: "user"`
// message — Mercury bakes the system prompt in server-side. Do not send a
// client-side system prompt; the endpoint returns 400 if you do.

/**
 * Per docs: editable region size dominates output latency. Centering around
 * the cursor with [-5, +10] is the recommended starting point.
 */
export const DEFAULT_EDITABLE_REGION_TOP_MARGIN = 5
export const DEFAULT_EDITABLE_REGION_BOTTOM_MARGIN = 10
export const MAX_EDITABLE_REGION_LINES = 25
