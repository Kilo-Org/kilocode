# attempt_completion

The `attempt_completion` tool signals that Kilo Code believes a task is complete and presents results to the user. It provides a summary of what was accomplished, optionally includes a command to demonstrate the result, and supports continued refinement through user feedback.

## Parameters

The tool accepts these parameters:

- `result` (required): The final result description summarizing what was accomplished
- `command` (optional): A CLI command to execute to demonstrate the result

## What It Does

This tool marks the end of a task by presenting a final summary of what was accomplished. It signals to both the user and the system that the current task is complete. When a command is provided, it can also demonstrate the result through a live execution.

## When is it used?

- When Kilo Code believes the user's task has been completed
- When summarizing what changes or improvements were made
- When demonstrating the current result with a command execution
- When providing a checkpoint for user feedback on the solution
- When transitioning from one phase of work to potential refinements

## Key Features

- Provides a clear signal that Kilo Code believes the task is complete
- Summarizes accomplishments in a concise message
- Optionally demonstrates results through command execution
- Enables user feedback for further refinements
- Displays results in a special UI format distinct from regular messages
- Captures task completion telemetry for system analytics
- Maintains a structured conversation flow by providing checkpoints
- Supports subtask completion within larger workflows
- Ensures users receive a clear summary of what was done
- Available in all modes as part of the "always available" tool group

## Limitations

- Should not be used until previous tool uses are confirmed successful (guideline, not enforced)
- Limited to a single command for result demonstration
- Cannot present multiple command options
- Commands require user approval before execution
- Limited to demonstrating results that can be shown via CLI commands
- Cannot be used for partial task completion or progress updates
- Result formatting strips XML closing tags through internal processing

## How It Works

When the `attempt_completion` tool is invoked, it follows this process:

1. **Safety Consideration** (guideline, not enforced):
   - The AI is instructed to confirm previous tool uses were successful
   - This is a best practice rather than a programmatically enforced mechanism

2. **Result Presentation**:
   - Displays the completion message to the user in a special "completion_result" UI format
   - Removes XML closing tags from the result text using the `removeClosingTag` function
   - Presents the result differently than regular messages for visual distinction

3. **Command Execution** (if provided):
   - Requests user approval before executing the command
   - Only executes if the user approves
   - Executes the command using the system's command execution functionality
   - Shows the result of the command to the user

4. **Feedback Collection**:
   - Waits for user feedback on the completion result
   - Processes this feedback and returns it to the AI
   - Enables continued refinement based on user input

5. **Task Completion and Continuation**:
   - Signals the task as completed in the system
   - Captures telemetry data for the completed task
   - For subtasks, offers to finish the subtask and resume the parent task
   - Supports continued conversation through the feedback mechanism

6. **Implementation Integration**:
   - Tool results are parsed through the system's parsing mechanism in `parse-assistant-message.ts`
   - The tool is part of the "ALWAYS_AVAILABLE_TOOLS" constant, making it available in all modes

## Result Formatting Guidelines

The result message should follow these guidelines:

- Clearly communicate what was accomplished
- Be concise but complete
- Focus on the value delivered to the user
- Avoid unnecessary pleasantries or filler text
- Maintain a professional, straightforward tone
- Present information in a way that's easy to scan and understand
- Acknowledge that the user may provide feedback for further refinements

Note: The system automatically strips XML closing tags from the result text through the `removeClosingTag` function.

## Command Selection Guidelines

When including a command, follow these guidelines:

- Choose commands that visually demonstrate the result
- Prefer commands that show the user what was created or modified
- Examples include:
  * `open index.html` to display a created website
  * `npm start` to launch a development server
  * `python app.py` to run a created application
- Avoid commands that merely print text (like `echo` or `cat`)
- Remember that commands require user approval before execution
- Ensure the command is valid for the user's operating system

## Feedback and UI Representation

The `attempt_completion` tool has a unique feedback mechanism:

- Results appear in a special "completion_result" UI format distinct from regular messages
- The system waits for user feedback after presenting the result
- Feedback is processed and returned to Kilo Code for further refinements
- This creates an iterative improvement cycle rather than ending the conversation
- The UI includes special elements for providing feedback
- Results serve as clear checkpoints in the conversation flow

When used within subtasks:
- The system offers to finish the subtask and resume the parent task
- If approved, the subtask is completed with a summary
- The parent task resumes with context from the completed subtask
- This enables complex, nested workflows while maintaining context

## Examples When Used

- When creating a website, Kilo Code presents the solution and uses `open index.html` to show the result. The user provides feedback, and Kilo Code refines the design.
- When implementing a feature, Kilo Code summarizes the changes and their impact. The user requests additional test coverage, and Kilo Code continues the task.
- When fixing bugs, Kilo Code explains what was fixed and how the solution addresses the Kilo Codet cause. The user confirms the fix works.
- When setting up a development environment, Kilo Code confirms all components are installed. The user requests additional configuration, and Kilo Code continues.
- When creating a data processing script, Kilo Code summarizes the functionality. The user suggests performance improvements, and Kilo Code optimizes the code.

## Usage Examples


Completing a task with just a result summary:
```
<attempt_completion>
<result>
I've updated the CSS for the navigation bar to match the design mockup. The changes include:
1. Updated color scheme to use the new brand colors
2. Added responsive behavior for mobile devices
3. Fixed the alignment issues in the dropdown menus
</result>
</attempt_completion>
```

Completing a task with a result and demonstration command:
```
<attempt_completion>
<result>
I've created a simple React application with the following features:
1. A responsive landing page with the requested hero section
2. A working contact form with validation
3. Navigation between all three requested pages
4. Styling that matches the provided design mockup
</result>
<command>npm start</command>
</attempt_completion>
```

Completing a Python script task with execution:
```
<attempt_completion>
<result>
I've created a data processing script that:
1. Reads the CSV files from the data directory
2. Cleans and normalizes the data as requested
3. Generates the summary statistics in JSON format
4. Outputs the processed data to the output directory
</result>
<command>python process_data.py</command>
</attempt_completion>
```
