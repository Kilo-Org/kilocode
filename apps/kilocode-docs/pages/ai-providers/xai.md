---
sidebar_label: xAI (Grok)
---

# Using xAI (Grok) With Kilo Code

xAI is the company behind Grok, a large language model known for its conversational abilities and large context window. Grok models are designed to provide helpful, informative, and contextually relevant responses.

**Website:** [https://x.ai/](https://x.ai/)

## Getting an API Key

1.  **Sign Up/Sign In:** Go to the [xAI Console](https://console.x.ai/). Create an account or sign in.
2.  **Navigate to API Keys:** Go to the API keys section in your dashboard.
3.  **Create a Key:** Click to create a new API key. Give your key a descriptive name (e.g., "Kilo Code").
4.  **Copy the Key:** **Important:** Copy the API key _immediately_. You will not be able to see it again. Store it securely.

## Configuration in Kilo Code

1.  **Open Kilo Code Settings:** Click the gear icon ({% codicon name="gear" /%}) in the Kilo Code panel.
2.  **Select Provider:** Choose "xAI" from the "API Provider" dropdown.
3.  **Enter API Key:** Paste your xAI API key into the "xAI API Key" field.
4.  **Select Model:** Choose your desired Grok model from the "Model" dropdown.

## Reasoning Capabilities

Some models feature specialized reasoning capabilities, allowing them to "think before responding" - particularly useful for complex problem-solving tasks.

### Controlling Reasoning Effort

When using reasoning-enabled models, you can control how hard the model thinks with the `reasoning_effort` parameter:

- `low`: Minimal thinking time, using fewer tokens for quick responses
- `high`: Maximum thinking time, leveraging more tokens for complex problems

Choose `low` for simple queries that should complete quickly, and `high` for harder problems where response latency is less important.

### Key Features

- **Step-by-Step Problem Solving**: The model thinks through problems methodically before delivering an answer
- **Math & Quantitative Strength**: Excels at numerical challenges and logic puzzles
- **Reasoning Trace Access**: The model's thinking process is available via the `reasoning_content` field in the response completion object

## Tips and Notes

- **Context Window:** Most Grok models feature large context windows (up to 131K tokens), allowing you to include substantial amounts of code and context in your prompts.
- **Vision Capabilities:** Select vision-enabled models (`grok-2-vision-latest`, `grok-2-vision`, etc.) when you need to process or analyze images.
- **Pricing:** Pricing varies by model, with input costs ranging from $0.3 to $5.0 per million tokens and output costs from $0.5 to $25.0 per million tokens. Refer to the xAI documentation for the most current pricing information.
- **Performance Tradeoffs:** "Fast" variants typically offer quicker response times but may have higher costs, while "mini" variants are more economical but may have reduced capabilities.
