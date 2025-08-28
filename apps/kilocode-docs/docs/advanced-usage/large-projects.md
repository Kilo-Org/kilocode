# Working with Large Projects

Kilo Code can be used with projects of any size, but large projects require some extra care to manage context effectively. Here are some tips for working with large codebases:

## Understanding Context Limits

Kilo Code uses large language models (LLMs) that have a limited "context window."  This is the maximum amount of text (measured in tokens) that the model can process at once.  If the context is too large, the model may not be able to understand your request or generate accurate responses.

The context window includes:

*   The system prompt (instructions for Kilo Code).
*   The conversation history.
*   The content of any files you mention using `@`.
*   The output of any commands or tools Kilo Code uses.

## Strategies for Managing Context

1.  **Be Specific:**  When referring to files or code, use specific file paths and function names.  Avoid vague references like "the main file."

2.  **Use Context Mentions Effectively:** Use `@/path/to/file.ts` to include specific files. Use `@problems` to include current errors and warnings.  Use `@` followed by a commit hash to reference specific Git commits.

3.  **Break Down Tasks:** Divide large tasks into smaller, more manageable sub-tasks.  This helps keep the context focused.

4.  **Summarize:**  If you need to refer to a large amount of code, consider summarizing the relevant parts in your prompt instead of including the entire code.

5.  **Prioritize Recent History:** Kilo Code automatically truncates older messages in the conversation history to stay within the context window. Be mindful of this, and re-include important context if needed.

6.  **Use Prompt Caching (if available):** Some API providers like Anthropic, OpenAI, OpenRouter and Requesty support "prompt caching". This caches your prompts for use in future tasks and helps reduce the cost and latency of requests.

## Example: Refactoring a Large File

Let's say you need to refactor a large TypeScript file (`src/components/MyComponent.tsx`).  Here's a possible approach:

1.  **Initial Overview:**
    ```
    @/src/components/MyComponent.tsx List the functions and classes in this file.
    ```

2.  **Target Specific Functions:**
    ```
    @/src/components/MyComponent.tsx Refactor the `processData` function to use `async/await` instead of Promises.
    ```

3.  **Iterative Changes:**  Make small, incremental changes, reviewing and approving each step.

By breaking down the task and providing specific context, you can work effectively with large files even with a limited context window.