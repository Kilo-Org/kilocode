# Cline API

The Roo Code extension exposes an API that can be used by other extensions.
To use this API in your extension:

1. Install `@roo-code/types` with npm, pnpm, or yarn.
2. Import the `RooCodeAPI` type.
3. Load the extension API.

```typescript
import { RooCodeAPI } from "@roo-code/types"

const extension = vscode.extensions.getExtension<RooCodeAPI>("RooVeterinaryInc.roo-cline")

    if (!clineExtension?.isActive) {
    	throw new Error("Cline extension is not activated")
    }

    const cline = clineExtension.exports

    if (cline) {
    	// Now you can use the API

    	// Set custom instructions
    	await cline.setCustomInstructions("Talk like a pirate")

    	// Get custom instructions
    	const instructions = await cline.getCustomInstructions()
    	console.log("Current custom instructions:", instructions)

    	// Start a new task with an initial message
    	await cline.startNewTask("Hello, Cline! Let's make a new project...")

    	// Start a new task with an initial message and images
    	await cline.startNewTask("Use this design language", ["data:image/webp;base64,..."])

    	// Send a message to the current task
    	await cline.sendMessage("Can you fix the @problems?")

    	// Simulate pressing the primary button in the chat interface (e.g. 'Save' or 'Proceed While Running')
    	await cline.pressPrimaryButton()

    	// Simulate pressing the secondary button in the chat interface (e.g. 'Reject')
    	await cline.pressSecondaryButton()
    } else {
    	console.error("Cline API is not available")
    }
    ```

    **Note:** To ensure that the `kilocode.Kilo-Code` extension is activated before your extension, add it to the `extensionDependencies` in your `package.json`:

    ```json
    "extensionDependencies": [
        "kilocode.Kilo-Code"
    ]
    ```

For detailed information on the available methods and their usage, refer to the `cline.d.ts` file.
````
