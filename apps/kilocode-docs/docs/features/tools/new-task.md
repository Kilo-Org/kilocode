# new_task

The `new_task` tool creates subtasks with specialized modes while maintaining a parent-child relationship. It breaks down complex projects into manageable pieces, each operating in the mode best suited for specific work.

## Parameters

The tool accepts these parameters:

- `mode` (required): The slug of the mode to start the new task in (e.g., "code", "ask", "architect")
- `message` (required): The initial user message or instructions for this new task

## What It Does

This tool creates a new task instance with a specified starting mode and initial message. It allows complex workflows to be divided into subtasks with their own conversation history. Parent tasks are paused during subtask execution and resumed when the subtask completes, with results transferred back to the parent.

## When is it used?

- When breaking down complex projects into separate, focused subtasks
- When different aspects of a task require different specialized modes
- When different phases of work benefit from context separation
- When organizing multi-phase development workflows

## Key Features

- Creates subtasks with their own conversation history and specialized mode
- Pauses parent tasks for later resumption
- Maintains hierarchical task relationships for navigation
- Transfers results back to parent tasks upon completion
- Supports workflow segregation for complex projects
- Allows different parts of a project to use modes optimized for specific work
- Requires explicit user approval for task creation
- Provides clear task transition in the UI

## Limitations

- Cannot create tasks with modes that don't exist
- Requires user approval before creating each new task
- Task interface may become complex with deeply nested subtasks
- Subtasks inherit certain workspace and extension configurations from parents
- May require re-establishing context when switching between deeply nested tasks
- Task completion needs explicit signaling to properly return to parent tasks

## How It Works

When the `new_task` tool is invoked, it follows this process:

1. **Parameter Validation**:
   - Validates the required `mode` and `message` parameters
   - Verifies that the requested mode exists in the system

2. **Task Stack Management**:
   - Maintains a task stack that tracks all active and paused tasks
   - Preserves the current mode for later resumption
   - Sets the parent task to paused state

3. **Task Context Management**:
   - Creates a new task context with the provided message
   - Assigns unique taskId and instanceId identifiers for state management
   - Captures telemetry data on tool usage and task lifecycles

4. **Mode Switching and Integration**:
   - Switches to the specified mode with appropriate role and capabilities
   - Initializes the new task with the provided message
   - Integrates with VS Code's command palette and code actions

5. **Task Completion and Result Transfer**:
   - When subtask completes, result is passed back to parent task via `finishSubTask()`
   - Parent task resumes in its original mode
   - Task history and token usage metrics are updated
   - The `taskCompleted` event is emitted with performance data

## Examples When Used

- When a front-end developer needs to architect a new feature, implement the code, and document it, they can create separate tasks for each phase with results flowing from one phase to the next.
- When debugging an issue before implementing a fix, the debugging task can document findings that are passed to the implementation task.
- When developing a full-stack application, database schema designs from an architect-mode task inform implementation details in a subsequent code-mode task.
- When documenting a system after implementation, the documentation task can reference the completed implementation while using documentation-specific features.

## Usage Examples

Creating a new task in code mode:
```
<new_task>
<mode>code</mode>
<message>Implement a user authentication service with login, registration, and password reset functionality.</message>
</new_task>
```

Creating a documentation task after completing implementation:
```
<new_task>
<mode>docs</mode>
<message>Create comprehensive API documentation for the authentication service we just built.</message>
</new_task>
```

Breaking down a complex feature into architectural planning and implementation:
```
<new_task>
<mode>architect</mode>
<message>Design the database schema and system architecture for our new e-commerce platform.</message>
</new_task>
```
