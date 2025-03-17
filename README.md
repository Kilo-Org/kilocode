# Kilo Code

Kilo Code is an open source AI agent VS Code extension. It helps you write code more efficiently by generating code, automating tasks, and providing suggestions.

Kilo Code has a free tier with $15 worth of Claude 3.7 Sonnet tokens. We'll give out more free tokens if you leave useful feedback.

- [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=kilocode.Kilo-Code) (download)
- [Home page](https://kilocode.ai) (learn more)
- [Discord](https://discord.gg/fxrhCFGhkP) (join community)
- [Reddit](https://www.reddit.com/r/kilocode/) (start discussing)
- [Substack](https://blog.kilocode.ai/) (blog)

## Key Features

- **AI-Powered Code Generation:** Generate code from natural language descriptions.
- **Automated Refactoring:** Refactor and improve existing code.
- **Intelligent Code Completion:** Get smart suggestions as you type.
- **Task Automation:** Automate repetitive coding tasks.

## Get Started in 2 Minutes

1.  Install the Kilo Code extension from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=kilocode.Kilo-Code).
2.  Log in with your Google Account to get $15 in free Claude 3.7 Sonnet credits.
3.  Start coding!

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
