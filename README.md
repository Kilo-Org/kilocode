<p align="center">
  <a href="https://marketplace.visualstudio.com/items?itemName=kilocode.Kilo-Code" target="_blank" rel="noopener noreferrer">
    <img width="120" src="assets/icons/logo-outline-black.png" alt="Kilo Code logo">
  </a>

</p>
<div align="center">

<a href="https://marketplace.visualstudio.com/items?itemName=kilocode.Kilo-Code" target="_blank"><img src="https://img.shields.io/badge/Get%20%2415%20of%20free%20tokens%20for%20Claude%203.7-green?style=for-the-badge&logo=claude&logoColor=white" alt="Get $15 of Claude 3.7 tokens for free"></a>
<a href="https://marketplace.visualstudio.com/items?itemName=kilocode.Kilo-Code" target="_blank"><img src="https://img.shields.io/badge/Download%20on%20VS%20Code%20Marketplace-blue?style=for-the-badge&logo=visualstudiocode&logoColor=white" alt="Download on VS Code Marketplace"></a>

<a href="https://www.reddit.com/r/kilocode/" target="_blank"><img src="https://img.shields.io/badge/Join%20Reddit-FF4500?style=for-the-badge&logo=reddit&logoColor=white" alt="Join Reddit"></a>
<a href="https://discord.gg/fxrhCFGhkP" target="_blank"><img src="https://img.shields.io/badge/Join%20Discord-5865F2?style=for-the-badge&logo=discord&logoColor=white" alt="Join Discord"></a>
<a href="https://www.producthunt.com/posts/kilo-code-for-vs-code?embed=true&utm_source=badge-featured&utm_medium=badge&utm_souce=badge-kilo&#0045;code&#0045;for&#0045;vs&#0045;code" target="_blank"><img src="https://api.producthunt.com/widgets/embed-image/v1/featured.png?post_id=941299&theme=light&t=1742909649388" alt="Kilo&#0032;Code&#0032;for&#0032;VS&#0032;Code&#0032; - Lightning&#0032;speed&#0032;autonomous&#0032;AI&#0032;coding&#0032;agent | Product Hunt" style="height: 30px;" height="30" /></a>

</div>

<div align="center">
  <h1>Kilo Code</h1>
</div>
<br/>

Kilo Code is an open-source AI agent extension for Visual Studio Code. It helps you write code more efficiently by generating code, automating tasks, and providing suggestions.

Kilo Code has a free tier with $15 worth of Claude 3.7 Sonnet tokens. We'll give out more free tokens if you leave useful feedback.

- [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=kilocode.Kilo-Code) (download)
- [Home page](https://kilocode.ai) (learn more)
- [Discord](https://discord.gg/fxrhCFGhkP) (join community)
- [Reddit](https://www.reddit.com/r/kilocode/) (start discussing)
- [Substack](https://blog.kilocode.ai/) (blog)
- [Product Hunt](https://www.producthunt.com/products/kilocode) (vote)

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
