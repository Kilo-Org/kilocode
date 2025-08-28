# switch_mode

The `switch_mode` tool enables Kilo Code to change between different operational modes, each with specialized capabilities for specific types of tasks. This allows seamless transitions between modes like Code, Architect, Ask, or Debug when the current task requires different expertise.

## Parameters

The tool accepts these parameters:

- `mode_slug` (required): The slug of the mode to switch to (e.g., "code", "ask", "architect")
- `reason` (optional): The reason for switching modes, providing context for the user

## What It Does

This tool requests a mode change when the current task would be better handled by another mode's capabilities. It maintains context while shifting Kilo Code's focus and available toolsets to match the requirements of the new task phase.

## When is it used?

- When transitioning from information gathering to code implementation
- When shifting from coding to architecture or design
- When the current task requires capabilities only available in a different mode
- When specialized expertise is needed for a particular phase of a complex project

## Key Features

- Maintains context continuity across mode transitions
- Provides clear reasoning for mode switch recommendations
- Requires user approval for all mode changes
- Enforces tool group restrictions specific to each mode
- Seamlessly adapts tool availability based on the selected mode
- Works with both standard and custom modes
- Displays the mode switch and reasoning in the UI
- Uses XML-style formatting for parameter specification
- Handles file type restrictions specific to certain modes

## Limitations

- Cannot switch to modes that don't exist in the system
- Requires explicit user approval for each mode transition
- Cannot use tools specific to a mode until the switch is complete
- Applies a 500ms delay after mode switching to allow the change to take effect
- Some modes have file type restrictions (e.g., Architect mode can only edit markdown files)
- Mode preservation for resumption applies only to the `new_task` functionality, not general mode switching

## How It Works

When the `switch_mode` tool is invoked, it follows this process:

1. **Request Validation**:
   - Validates that the requested mode exists in the system
   - Checks that the `mode_slug` parameter is provided and valid
   - Verifies the user isn't already in the requested mode
   - Ensures the `reason` parameter (if provided) is properly formatted

2. **Mode Transition Preparation**:
   - Packages the mode change request with the provided reason
   - Presents the change request to the user for approval

3. **Mode Activation (Upon User Approval)**:
   - Updates the UI to reflect the new mode
   - Adjusts available tools based on the mode's tool group configuration
   - Applies the mode-specific prompt and behavior
   - Applies a 500ms delay to allow the change to take effect before executing next tool
   - Enforces any file restrictions specific to the mode

4. **Continuation**:
   - Proceeds with the task using the capabilities of the new mode
   - Retains relevant context from the previous interaction

## Tool Group Association

The `switch_mode` tool belongs to the "modes" tool group but is also included in the "always available" tools list. This means:

- It can be used in any mode regardless of the mode's configured tool groups
- It's available alongside other core tools like `ask_followup_question` and `attempt_completion`
- It allows mode transitions at any point in a workflow when task requirements change

## Mode Structure

Each mode in the system has a specific structure:

- `slug`: Unique identifier for the mode (e.g., "code", "ask")
- `name`: Display name for the mode (e.g., "Code", "Ask")
- `roleDefinition`: The specialized role and capabilities of the mode
- `customInstructions`: Optional mode-specific instructions that guide behavior
- `groups`: Tool groups available to the mode with optional restrictions

## Mode Capabilities

The core modes provide these specialized capabilities:

- **Code Mode**: Focused on coding tasks with full access to code editing tools
- **Architect Mode**: Specialized for system design and architecture planning, limited to editing markdown files only
- **Ask Mode**: Optimized for answering questions and providing information
- **Debug Mode**: Equipped for systematic problem diagnosis and resolution

## Custom Modes

Beyond the core modes, the system supports custom project-specific modes:

- Custom modes can be defined with specific tool groups enabled
- They can specify custom role definitions and instructions
- The system checks custom modes first before falling back to core modes
- Custom mode definitions take precedence over core modes with the same slug

## File Restrictions

Different modes may have specific file type restrictions:

- **Architect Mode**: Can only edit files matching the `.md` extension
- Attempting to edit restricted file types results in a `FileRestrictionError`
- These restrictions help enforce proper separation of concerns between modes

## Examples When Used

- When discussing a new feature, Kilo Code switches from Ask mode to Architect mode to help design the system structure.
- After completing architecture planning in Architect mode, Kilo Code switches to Code mode to implement the designed features.
- When encountering bugs during development, Kilo Code switches from Code mode to Debug mode for systematic troubleshooting.

## Usage Examples

Switching to Code mode for implementation:
```
<switch_mode>
<mode_slug>code</mode_slug>
<reason>Need to implement the login functionality based on the architecture we've discussed</reason>
</switch_mode>
```

Switching to Architect mode for design:
```
<switch_mode>
<mode_slug>architect</mode_slug>
<reason>Need to design the system architecture before implementation</reason>
</switch_mode>
```

Switching to Debug mode for troubleshooting:
```
<switch_mode>
<mode_slug>debug</mode_slug>
<reason>Need to systematically diagnose the authentication error</reason>
</switch_mode>
```

Switching to Ask mode for information:
```
<switch_mode>
<mode_slug>ask</mode_slug>
<reason>Need to answer questions about the implemented feature</reason>
</switch_mode>
```
