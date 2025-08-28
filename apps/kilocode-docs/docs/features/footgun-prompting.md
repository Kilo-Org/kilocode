---
sidebar_label: "Footgun Prompting"
---

# Footgun Prompting: Override System Prompts

Footgun Prompting, AKA Overriding System Prompt, allows advanced users to completely replace the default system prompt for a specific Kilo Code mode. This provides granular control over the AI's behavior but bypasses built-in safeguards.

:::info **footgun** _(noun)_

1.  _(programming slang, humorous, derogatory)_ Any feature likely to lead to the programmer shooting themself in the foot.

> The System Prompt Override is considered a footgun because modifying the core instructions without a deep understanding can lead to unexpected or broken behavior, especially regarding tool usage and response consistency.

:::

## How It Works

1.  **Override File:** Create a file named `.kilocode/system-prompt-{mode-slug}` in your workspace root (e.g., `.kilocode/system-prompt-code` for the Code mode).
2.  **Content:** The content of this file becomes the new system prompt for that specific mode.
3.  **Activation:** Kilo Code automatically detects this file. When present, it replaces most of the standard system prompt sections.
4.  **Preserved Sections:** Only the core `roleDefinition` and any `customInstructions` you've set for the mode are kept alongside your override content. Standard sections like tool descriptions, rules, and capabilities are bypassed.
5.  **Construction:** The final prompt sent to the model looks like this:

    ```
    ${roleDefinition}

    ${content_of_your_override_file}

    ${customInstructions}
    ```

## Accessing the Feature

You can find the option and instructions within the Kilo Code UI:

1.  Click the MODE selector in the bottom-left of the Kilo Code text-input box.
2.  Click "Edit..." at the bottom of the mode-selection list
3.  Expand the **"Advanced: Override System Prompt"** section at the bottom.
4.  Clicking the file path link within the explanation will open or create the correct override file for the currently selected mode in VS Code.

<img src="/docs/img/footgun-prompting/footgun-prompting.png" alt="UI showing the Advanced: Override System Prompt section" width="500" />

## Key Considerations & Warnings

- **Intended Audience:** Best suited for users deeply familiar with Kilo Code's prompting system and the implications of modifying core instructions.
- **Impact on Functionality:** Custom prompts override standard instructions, including those for tool usage and response consistency. This can cause unexpected behavior or errors if not managed carefully.
- **Mode-Specific:** Each override file applies only to the mode specified in its filename (`{mode-slug}`).
- **No File, No Override:** If the `.kilocode/system-prompt-{mode-slug}` file doesn't exist, Kilo Code uses the standard system prompt generation process for that mode.
- **Directory Creation:** Kilo Code ensures the `.kilocode` directory exists before attempting to read or create the override file.

Use this feature cautiously. While powerful for customization, incorrect implementation can significantly degrade Kilo Code's performance and reliability for the affected mode.
