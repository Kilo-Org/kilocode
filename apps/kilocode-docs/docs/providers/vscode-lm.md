---
sidebar_label: VS Code Language Model API
---

# Using VS Code Language Model API With Kilo Code

Kilo Code includes *experimental* support for the [VS Code Language Model API](https://code.visualstudio.com/api/language-extensions/language-model-access). This API allows extensions to provide access to language models directly within VS Code.  This means you can potentially use models from:

*   **GitHub Copilot:** If you have a Copilot subscription and the extension installed.
*   **Other VS Code Extensions:** Any extension that implements the Language Model API.

**Important:** This integration is highly experimental and may not work as expected.  It is dependent on other extensions correctly implementing the VS Code Language Model API.

## Prerequisites

*   **VS Code:**  The Language Model API is available through VS Code (and is not currently supported by Cursor).
*   **A Language Model Provider Extension:**  You need an extension that provides a language model.  Examples include:
    *   **GitHub Copilot:**  If you have a Copilot subscription, the GitHub Copilot and GitHub Copilot Chat extensions can provide models.
    *   **Other Extensions:**  Search the VS Code Marketplace for extensions that mention "Language Model API" or "lm".  There may be other experimental extensions available.

## Configuration

1.  **Open Kilo Code Settings:** Click the gear icon (<Codicon name="gear" />) in the Kilo Code panel.
2.  **Select Provider:** Choose "VS Code LM API" from the "API Provider" dropdown.
3.  **Select Model:**  The "Language Model" dropdown will (eventually) list available models. The format is `vendor/family`. For example, if you have Copilot, you might see options like:
    *   `copilot - claude-3.5-sonnet`
    *   `copilot - o3-mini`
    *   `copilot - o1-ga`
    *   `copilot - gemini-2.0-flash`

## Limitations

*   **Experimental API:**  The VS Code Language Model API is still under development.  Expect changes and potential instability.
*   **Extension Dependent:**  This feature relies entirely on other extensions providing models.  Kilo Code cannot directly control which models are available.
*   **Limited Functionality:**  The VS Code Language Model API may not support all the features of other API providers (e.g., image input, streaming, detailed usage information).
*   **No Direct Cost Control:**  You are subject to the pricing and terms of the extension providing the model.  Kilo Code cannot directly track or limit costs.
*   **GitHub Copilot Rate Limits:** When using the VS Code LM API with GitHub Copilot, be aware that GitHub may impose rate limits on Copilot usage. These limits are controlled by GitHub, not Kilo Code.


## Troubleshooting

*   **No Models Appear:**
    *   Ensure you have VS Code installed.
    *   Ensure you have a language model provider extension installed and enabled (e.g., GitHub Copilot, GitHub Copilot Chat).
    *   If using Copilot, make sure that you have sent a Copilot Chat message using the model you would like to use.
*   **Unexpected Behavior:**  If you encounter unexpected behavior, it's likely an issue with the underlying Language Model API or the provider extension.  Consider reporting the issue to the provider extension's developers.
