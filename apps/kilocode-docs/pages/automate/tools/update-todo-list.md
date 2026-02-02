# update_todo_list

The `update_todo_list` tool replaces the entire TODO list with an updated checklist reflecting the current state. It provides step-by-step task tracking, allowing confirmation of completion before updating and dynamic addition of new todos discovered during complex tasks.

## Parameters

The tool accepts these parameters:

- `todos` (required): A markdown checklist with task descriptions and status indicators

## What It Does

This tool manages a comprehensive TODO list that tracks task progress through different status states. It replaces the entire list with each update, ensuring the current state accurately reflects all pending, in-progress, and completed tasks. The system displays the TODO list as reminders in subsequent messages.

## When is it used?

- When tasks involve multiple steps requiring systematic tracking
- When new actionable items are discovered during task execution
- When updating the status of several todos simultaneously
- When complex projects benefit from clear, stepwise progress tracking
- When organizing multi-phase workflows with dependencies

## Key Features

- Maintains a single-level markdown checklist with three status states
- Updates multiple task statuses in a single operation
- Dynamically adds new todos as they're discovered during execution
- Provides visual progress tracking through status indicators
- Integrates with the reminder system for persistent task visibility
- Supports task reordering based on execution priority
- Preserves all unfinished tasks unless explicitly removed
- Enables efficient batch status updates

## Limitations

- Limited to single-level checklists (no nesting or subtasks)
- Cannot remove tasks unless they're completed or no longer relevant
- Requires complete list replacement rather than incremental updates
- Status changes must be explicitly managed through tool calls
- No built-in task dependency tracking
- Cannot schedule tasks for future execution
- Limited to three status states (pending, in-progress, completed)

## Status Indicators

The tool uses three distinct status indicators:

- `[ ]` **Pending**: Task not yet started
- `[-]` **In Progress**: Task currently being worked on
- `[x]` **Completed**: Task fully finished with no unresolved issues

## How It Works

When the `update_todo_list` tool is invoked, it follows this process:

1. **Status Validation**:

    - Parses the markdown checklist format
    - Validates status indicators are properly formatted
    - Ensures task descriptions are clear and actionable

2. **List Replacement**:

    - Completely replaces the existing TODO list
    - Preserves task order as specified in the update
    - Maintains task descriptions and status states

3. **Reminder Integration**:

    - Integrates updated list with the reminder system
    - Displays current tasks in subsequent message headers
    - Provides persistent visibility of task progress

4. **Progress Tracking**:
    - Tracks completion status across multiple updates
    - Maintains task history for reference
    - Supports workflow continuation across sessions

## Best Practices

### Task Management Guidelines

- Mark tasks as completed immediately after all work is finished
- Start the next task by marking it as in-progress
- Add new todos as soon as they are identified during execution
- Use clear, descriptive task names that indicate specific actions
- Order tasks by logical execution sequence or priority

### Status Update Patterns

- Update multiple statuses simultaneously when transitioning between tasks
- Confirm task completion before marking as finished
- Keep in-progress tasks focused on current work
- Add blocking tasks when dependencies are discovered

### When to Use

Use this tool when:

- The task involves multiple steps or requires ongoing tracking
- New actionable items are discovered during task execution
- Multiple todos need status updates simultaneously
- Complex tasks benefit from clear progress visualization

Avoid using when:

- There is only a single, trivial task
- The task can be completed in one or two simple steps
- The request is purely conversational or informational

## Examples When Used

- When implementing a multi-component feature requiring frontend, backend, and database changes
- When debugging issues that reveal multiple related problems requiring fixes
- When setting up development environments with multiple configuration steps
- When documenting systems that require research, writing, and review phases
- When refactoring code that affects multiple files and requires testing

## Usage Examples

Initial task breakdown:

```
<update_todo_list>
<todos>
[-] Analyze requirements and create technical specification
[ ] Design database schema and API endpoints
[ ] Implement backend authentication service
[ ] Create frontend login components
[ ] Write comprehensive tests
[ ] Update documentation
</todos>
</update_todo_list>
```

Updating progress and adding discovered tasks:

```
<update_todo_list>
<todos>
[x] Analyze requirements and create technical specification
[x] Design database schema and API endpoints
[-] Implement backend authentication service
[ ] Create frontend login components
[ ] Write comprehensive tests
[ ] Update documentation
[ ] Add password reset functionality
[ ] Implement rate limiting for login attempts
</todos>
</update_todo_list>
```

Completing multiple tasks and transitioning focus:

```
<update_todo_list>
<todos>
[x] Analyze requirements and create technical specification
[x] Design database schema and API endpoints
[x] Implement backend authentication service
[x] Create frontend login components
[-] Write comprehensive tests
[ ] Update documentation
[ ] Add password reset functionality
[ ] Implement rate limiting for login attempts
</todos>
</update_todo_list>
```
