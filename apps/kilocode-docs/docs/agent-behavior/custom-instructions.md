# Custom Instructions

Custom Instructions allow you to personalize how Kilo Code behaves, providing specific guidance that shapes responses, coding style, and decision-making processes.

## What Are Custom Instructions?

Custom Instructions define specific Extension behaviors, preferences, and constraints beyond Kilo's basic role definition. Examples include coding style, documentation standards, testing requirements, and workflow guidelines.

:::info Custom Instructions vs Rules
Custom Instructions are IDE-wide and are applied across all workspaces and maintain your preferences regardless of which project you're working on. Unlike Instructions, [Custom Rules](/agent-behavior/custom-rules) are project specific and allow you to setup workspace-based ruleset.
:::

## Setting Custom Instructions

**How to set them:**

<img src="/docs/img/custom-instructions/custom-instructions.png" alt="Kilo Code Modes tab showing global custom instructions interface" width="600" />
1.  **Open Modes Tab:** Click the <Codicon name="organization" /> icon in the Kilo Code top menu bar
2.  **Find Section:** Find the "Custom Instructions for All Modes" section
3.  **Enter Instructions:** Enter your instructions in the text area
4.  **Save Changes:** Click "Done" to save your changes

#### Mode-Specific Instructions

Mode-specific instructions can be set using the Modes Tab

    <img src="/docs/img/custom-instructions/custom-instructions-3.png" alt="Kilo Code Modes tab showing mode-specific custom instructions interface" width="600" />
    * **Open Tab:** Click the <Codicon name="organization" /> icon in the Kilo Code top menu bar
    * **Select Mode:** Under the Modes heading, click the button for the mode you want to customize
    * **Enter Instructions:** Enter your instructions in the text area under "Mode-specific Custom Instructions (optional)"
    * **Save Changes:** Click "Done" to save your changes

        :::info Global Mode Rules
        If the mode itself is global (not workspace-specific), any custom instructions you set for it will also apply globally for that mode across all workspaces.
        :::

## Related Features

- [Custom Modes](/agent-behavior/custom-modes)
- [Custom Rules](/agent-behavior/custom-rules)
- [Settings Management](/basic-usage/settings-management)
- [Auto-Approval Settings](/features/auto-approving-actions)
