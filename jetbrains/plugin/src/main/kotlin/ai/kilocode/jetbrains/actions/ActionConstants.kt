// Copyright 2009-2025 Weibo, Inc.
// SPDX-FileCopyrightText: 2025 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

package ai.kilocode.jetbrains.actions

/**
 * Constants for action names displayed in the UI.
 * These represent the text shown to users in menus and context options.
 */
object ActionNames {
    /** Action to explain selected code */
    const val EXPLAIN = "Explain Code"

    /** Action to fix issues in selected code */
    const val FIX = "Fix Code"

    /** Action to fix logical issues in selected code */
    const val FIX_LOGIC = "Fix Logic"

    /** Action to improve selected code */
    const val IMPROVE = "Improve Code"

    /** Action to add selected code to context */
    const val ADD_TO_CONTEXT = "Add to Context"

    /** Action to create a new task */
    const val NEW_TASK = "New Task"
}

/**
 * Command identifiers used for internal command registration and execution.
 * These IDs are used to register commands with the IDE.
 */
object CommandIds {
    /** Command ID for explaining code */
    const val EXPLAIN = "kilo-code.explainCode"

    /** Command ID for fixing code */
    const val FIX = "kilo-code.fixCode"

    /** Command ID for improving code */
    const val IMPROVE = "kilo-code.improveCode"

    /** Command ID for adding to context */
    const val ADD_TO_CONTEXT = "kilo-code.addToContext"

    /** Command ID for creating a new task */
    const val NEW_TASK = "kilo-code.newTask"
}

/** Type alias for prompt type identifiers */
typealias SupportPromptType = String

/** Type alias for prompt parameters map */
typealias PromptParams = Map<String, Any?>

/**
 * Data class representing a prompt configuration with a template string.
 * Templates contain placeholders that will be replaced with actual values.
 */
data class SupportPromptConfig(val template: String)

/**
 * Collection of predefined prompt configurations for different use cases.
 * Each configuration contains a template with placeholders for dynamic content.
 */
object SupportPromptConfigs {
    /**
     * Template for enhancing user prompts.
     * Instructs the AI to generate an improved version of the user's input.
     */
    val ENHANCE = SupportPromptConfig(
        """Generate an enhanced version of this prompt (reply with only the enhanced prompt - no conversation, explanations, lead-in, bullet points, placeholders, or surrounding quotes):

${'$'}{userInput}""",
    )

    /**
     * Template for explaining code.
     * Provides structure for code explanation requests with file path and line information.
     */
    val EXPLAIN = SupportPromptConfig(
        """Explain the following code from file path ${'$'}{filePath}:${'$'}{startLine}-${'$'}{endLine}
${'$'}{userInput}

```
${'$'}{selectedText}
```

Please provide a clear and concise explanation of what this code does, including:
1. The purpose and functionality
2. Key components and their interactions
3. Important patterns or techniques used""",
    )

    /**
     * Template for fixing code issues.
     * Includes diagnostic information and structured format for issue resolution.
     */
    val FIX = SupportPromptConfig(
        """Fix any issues in the following code from file path ${'$'}{filePath}:${'$'}{startLine}-${'$'}{endLine}
${'$'}{diagnosticText}
${'$'}{userInput}

```
${'$'}{selectedText}
```

Please:
1. Address all detected problems listed above (if any)
2. Identify any other potential bugs or issues
3. Provide corrected code
4. Explain what was fixed and why""",
    )

    /**
     * Template for improving code quality.
     * Focuses on readability, performance, best practices, and error handling.
     */
    val IMPROVE = SupportPromptConfig(
        """Improve the following code from file path ${'$'}{filePath}:${'$'}{startLine}-${'$'}{endLine}
${'$'}{userInput}

```
${'$'}{selectedText}
```

Please suggest improvements for:
1. Code readability and maintainability
2. Performance optimization
3. Best practices and patterns
4. Error handling and edge cases

Provide the improved code along with explanations for each enhancement.""",
    )

    /**
     * Template for adding code to context.
     * Simple format that includes file path, line range, and selected code.
     */
    val ADD_TO_CONTEXT = SupportPromptConfig(
        """${'$'}{filePath}:${'$'}{startLine}-${'$'}{endLine}
```
${'$'}{selectedText}
```""",
    )

    /**
     * Template for adding terminal output to context.
     * Includes user input and terminal content.
     */
    val TERMINAL_ADD_TO_CONTEXT = SupportPromptConfig(
        """${'$'}{userInput}
Terminal output:
```
${'$'}{terminalContent}
```""",
    )

    /**
     * Template for fixing terminal commands.
     * Structured format for identifying and resolving command issues.
     */
    val TERMINAL_FIX = SupportPromptConfig(
        """${'$'}{userInput}
Fix this terminal command:
```
${'$'}{terminalContent}
```

Please:
1. Identify any issues in the command
2. Provide the corrected command
3. Explain what was fixed and why""",
    )

    /**
     * Template for explaining terminal commands.
     * Provides structure for command explanation with focus on functionality and behavior.
     */
    val TERMINAL_EXPLAIN = SupportPromptConfig(
        """${'$'}{userInput}
Explain this terminal command:
```
${'$'}{terminalContent}
```

Please provide:
1. What the command does
2. Explanation of each part/flag
3. Expected output and behavior""",
    )

    /**
     * Template for creating a new task.
     * Simple format that passes through user input directly.
     */
    val NEW_TASK = SupportPromptConfig(
        """${'$'}{userInput}""",
    )

    /**
     * Map of all available prompt configurations indexed by their type identifiers.
     * Used for lookup when creating prompts.
     */
    val configs = mapOf(
        "ENHANCE" to ENHANCE,
        "EXPLAIN" to EXPLAIN,
        "FIX" to FIX,
        "IMPROVE" to IMPROVE,
        "ADD_TO_CONTEXT" to ADD_TO_CONTEXT,
        "TERMINAL_ADD_TO_CONTEXT" to TERMINAL_ADD_TO_CONTEXT,
        "TERMINAL_FIX" to TERMINAL_FIX,
        "TERMINAL_EXPLAIN" to TERMINAL_EXPLAIN,
        "NEW_TASK" to NEW_TASK,
    )
}

/**
 * Utility object for working with support prompts.
 * Provides methods for creating and customizing prompts based on templates.
 */
object SupportPrompt {
    /**
     * Generates formatted diagnostic text from a list of diagnostic items.
     *
     * @param diagnostics List of diagnostic items containing source, message, and code
     * @return Formatted string of diagnostic messages or empty string if no diagnostics
     */
    private fun generateDiagnosticText(diagnostics: List<Map<String, Any?>>?): String {
        if (diagnostics.isNullOrEmpty()) return ""
        return "\nCurrent problems detected:\n" + diagnostics.joinToString("\n") { diagnostic ->
            @Suppress("UNCHECKED_CAST")
            val d = diagnostic as Map<String, Any?>
            val source = d["source"] as? String ?: "Error"
            val message = d["message"] as? String ?: ""
            val code = d["code"] as? String
            "- [$source] $message${code?.let { " ($it)" } ?: ""}"
        }
    }

    /**
     * Creates a prompt by replacing placeholders in a template with actual values.
     *
     * @param template The prompt template with placeholders
     * @param params Map of parameter values to replace placeholders
     * @return The processed prompt with placeholders replaced by actual values
     */
    private fun createPrompt(template: String, params: PromptParams): String {
        val pattern = Regex("""\$\{(.*?)}""")
        return pattern.replace(template) { matchResult ->
            val key = matchResult.groupValues[1]
            if (key == "diagnosticText") {
                @Suppress("UNCHECKED_CAST")
                generateDiagnosticText(params["diagnostics"] as? List<Map<String, Any?>>)
            } else if (params.containsKey(key)) {
                // Ensure the value is treated as a string for replacement
                val value = params[key]
                when (value) {
                    is String -> value
                    else -> {
                        // Convert non-string values to string for replacement
                        value?.toString() ?: ""
                    }
                }
            } else {
                // If the placeholder key is not in params, replace with empty string
                ""
            }
        }
    }

    /**
     * Gets the template for a specific prompt type, with optional custom overrides.
     *
     * @param customSupportPrompts Optional map of custom prompt templates
     * @param type The type of prompt to retrieve
     * @return The template string for the specified prompt type
     */
    fun get(customSupportPrompts: Map<String, String>?, type: SupportPromptType): String {
        return customSupportPrompts?.get(type) ?: SupportPromptConfigs.configs[type]?.template ?: ""
    }

    /**
     * Creates a complete prompt by getting the template and replacing placeholders.
     *
     * @param type The type of prompt to create
     * @param params Parameters to substitute into the template
     * @param customSupportPrompts Optional custom prompt templates
     * @return The final prompt with all placeholders replaced
     */
    fun create(type: SupportPromptType, params: PromptParams, customSupportPrompts: Map<String, String>? = null): String {
        val template = get(customSupportPrompts, type)
        return createPrompt(template, params)
    }
}
