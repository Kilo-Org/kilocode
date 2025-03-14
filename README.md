# Kilo Code

Kilo Code is an agentic AI coding assistant extension for VS Code. It helps you write code more efficiently by automating tasks, generating code, and providing intelligent suggestions.

## Key Features

- **AI-Powered Code Generation:** Generate code from natural language descriptions.
- **Automated Refactoring:** Refactor and improve existing code.
- **Intelligent Code Completion:** Get smart suggestions as you type.
- **Task Automation:** Automate repetitive coding tasks.

## Get Started

1.  Install the Kilo Code extension from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=kilocode.Kilo-Code).
2.  Configure your AI provider (e.g., OpenAI).
3.  Start coding!

## Resources

- [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=kilocode.Kilo-Code)
- [Documentation](https://kilocode.ai)
- [Discord](https://discord.gg/fxrhCFGhkP)
- [Reddit](https://www.reddit.com/r/kilocode/)
- [Blog](https://blog.kilocode.ai/)

## Local Setup & Development

1. **Clone** the repo:
    ```bash
    git clone https://github.com/Kilo-Org/kilocode.git
    ```
2. **Install dependencies**:
    ```bash
    npm run install:all
    ```

if that fails, try:
`bash
    npm run install:all
    `

3. **Build** the extension:
    ```bash
    npm run build
    ```
    - A `.vsix` file will appear in the `bin/` directory.
4. **Install** the `.vsix` manually if desired:
    ```bash
    code --install-extension bin/kilo-code-4.0.0.vsix
    ```
5. **Start the webview (Vite/React app with HMR)**:
    ```bash
    npm run dev
    ```
6. **Debug**:
    - Press `F5` (or **Run** → **Start Debugging**) in VSCode to open a new session with Kilo Code loaded.

Changes to the webview will appear immediately. Changes to the core extension will require a restart of the extension host.
