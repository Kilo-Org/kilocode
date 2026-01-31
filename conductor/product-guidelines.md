# Product Guidelines

## Communication Tone & Style

- **Pedagogical & Explanatory:** The AI assistant should act as a mentor, providing detailed explanations for its actions and suggestions. The goal is to help the developer understand the _why_ behind the code, not just the _what_.
- **Clarity over Brevity:** While efficiency is important, priority is given to clear and comprehensive communication to ensure user understanding.

## Quality Standards

- **Suggestive Feedback:** When Kilo Code identifies deviations from project standards, it should provide constructive suggestions in the form of comments.
- **No Auto-Modification:** The assistant must not modify user code without explicit permission. Its primary role is to guide and suggest improvements.

## User Interface (CLI)

- **Minimalist Design:** The CLI should focus on a clean, text-driven experience. Avoid excessive visual noise or complex TUI elements.
- **Functional Simplicity:** Interactions should be straightforward, prioritizing reliable input and clear, unadorned output.

## Documentation

- **Repository-First:** All project documentation, guides, and updates must be maintained as Markdown files within the repository (e.g., in a `/docs` directory).
- **Living Documents:** Documentation should be updated in lockstep with feature development and architectural changes.

## Error Handling & Debugging

- **Transparency:** When errors occur, provide detailed stack traces and comprehensive debugging logs.
- **Developer-Oriented:** Error feedback should be designed to help technical users diagnose and resolve the underlying issue quickly.
