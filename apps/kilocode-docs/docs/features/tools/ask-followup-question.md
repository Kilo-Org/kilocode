# ask_followup_question

The `ask_followup_question` tool enables interactive communication by asking specific questions to gather additional information needed to complete tasks effectively.

## Parameters

The tool accepts these parameters:

- `question` (required): The specific question to ask the user
- `follow_up` (optional): A list of 2-4 suggested answers that help guide user responses, each within `<suggest>` tags

## What It Does

This tool creates a conversational interface between Kilo Code and the user, allowing for gathering clarification, additional details, or user preferences when facing ambiguities or decision points. Each question can include suggested responses to streamline the interaction.

## When is it used?

- When critical information is missing from the original request
- When Kilo Code needs to choose between multiple valid implementation approaches
- When technical details or preferences are required to proceed
- When Kilo Code encounters ambiguities that need resolution
- When additional context would significantly improve the solution quality

## Key Features

- Provides a structured way to gather specific information without breaking workflow
- Includes suggested answers to reduce user typing and guide responses
- Maintains conversation history and context across interactions
- Supports responses containing images and code snippets
- Available in all modes as part of the "always available" tool set
- Enables direct user guidance on implementation decisions
- Formats responses with `<answer>` tags to distinguish them from regular conversation
- Resets consecutive error counter when used successfully

## Limitations

- Limited to asking one specific question per tool use
- Presents suggestions as selectable options in the UI
- Cannot force structured responses – users can still respond freely
- Excessive use can slow down task completion and create a fragmented experience
- Suggested answers must be complete, with no placeholders requiring user edits
- No built-in validation for user responses
- Contains no mechanism to enforce specific answer formats

## How It Works

When the `ask_followup_question` tool is invoked, it follows this process:

1. **Parameter Validation**: Validates the required `question` parameter and checks for optional suggestions

    - Ensures question text is provided
    - Parses any suggested answers from the `follow_up` parameter using the `fast-xml-parser` library
    - Normalizes suggestions into an array format even if there's only one suggestion

2. **JSON Transformation**: Converts the XML structure into a standardized JSON format for UI display

    ```typescript
    {
      question: "User's question here",
      suggest: [
        { answer: "Suggestion 1" },
        { answer: "Suggestion 2" }
      ]
    }
    ```

3. **UI Integration**:

    - Passes the JSON structure to the UI layer via the `ask("followup", ...)` method
    - Displays selectable suggestion buttons to the user in the interface
    - Creates an interactive experience for selecting or typing a response

4. **Response Collection and Processing**:

    - Captures user text input and any images included in the response
    - Wraps user responses in `<answer>` tags when returning to the assistant
    - Preserves any images included in the user's response
    - Maintains the conversational context by adding the response to the history
    - Resets the consecutive error counter when the tool is used successfully

5. **Error Handling**:
    - Tracks consecutive mistakes using a counter
    - Resets the counter when the tool is used successfully
    - Provides specific error messages:
        - For missing parameters: "Missing required parameter 'question'"
        - For XML parsing: "Failed to parse operations: [error message]"
        - For invalid format: "Invalid operations xml format"
    - Contains safeguards to prevent tool execution when required parameters are missing
    - Increments consecutive mistake count when errors occur

## Workflow Sequence

The question-answer cycle follows this sequence:

1. **Information Gap Recognition**: Kilo Code identifies missing information needed to proceed
2. **Specific Question Creation**: Kilo Code formulates a clear, targeted question
3. **Suggestion Development**: Kilo Code creates relevant suggested answers (optional but recommended)
4. **Tool Invocation**: Assistant invokes the tool with question and optional suggestions
5. **UI Presentation**: Question and suggestions are displayed to the user as interactive elements
6. **User Response**: The user selects a suggestion or provides a custom answer
7. **Message Handling**: System handles both partial and complete messages
    - For streaming responses, processes chunks as they arrive
    - For complete messages, processes the entire response at once
    - Maintains state consistency regardless of message chunking
8. **Response Processing**: System wraps the response in `<answer>` tags and preserves images
9. **Context Integration**: Response is added to the conversation history
10. **Task Continuation**: Kilo Code proceeds with the task using the new information

## Examples When Used

- When developing a web application, Kilo Code might ask about preferred styling frameworks (Bootstrap, Tailwind, custom CSS)
- When creating an API, Kilo Code might ask about authentication methods (JWT, OAuth, API keys)
- When refactoring code, Kilo Code might ask about prioritizing performance vs. readability
- When setting up a database, Kilo Code might ask about specific schema design preferences
- When creating a custom feature, Kilo Code might ask about specific behavior expectations
- When troubleshooting errors, Kilo Code might ask about specific environment details

## Response Format

When a user responds to a question, the response is formatted with `<answer>` tags for clarity and consistency. This format helps clearly separate the user's answer from other conversation elements.

Example response format:

```
<answer>
Use Tailwind CSS for utility-first styling with maximum flexibility
</answer>
```

Key characteristics of the response format:

- Surrounded by `<answer>` tags
- Preserves formatting of the original response
- Maintains images if included in the response
- Returns the complete text, even for long responses

## Usage Examples

Asking about implementation preferences:

```
<ask_followup_question>
<question>Which styling approach would you prefer for this web application?</question>
<follow_up>
<suggest>Use Bootstrap for rapid development with consistent components</suggest>
<suggest>Use Tailwind CSS for utility-first styling with maximum flexibility</suggest>
<suggest>Use vanilla CSS with custom styling for complete control and minimal dependencies</suggest>
</follow_up>
</ask_followup_question>
```

Requesting technical clarification:

```
<ask_followup_question>
<question>What database should this application use for storing user data?</question>
<follow_up>
<suggest>MongoDB for flexible schema and document-based storage</suggest>
<suggest>PostgreSQL for relational data with strong consistency guarantees</suggest>
<suggest>Firebase for real-time updates and simplified backend management</suggest>
<suggest>SQLite for lightweight local storage without external dependencies</suggest>
</follow_up>
</ask_followup_question>
```

Addressing ambiguity in requirements:

```
<ask_followup_question>
<question>How should the application handle user authentication?</question>
<follow_up>
<suggest>Implement email/password authentication with account verification</suggest>
<suggest>Use social login providers (Google, GitHub, etc.) for quick signup</suggest>
<suggest>Implement both email/password and social login options</suggest>
</follow_up>
</ask_followup_question>
```
