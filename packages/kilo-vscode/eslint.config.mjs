import typescriptEslint from "typescript-eslint"
import eslintConfigPrettier from "eslint-config-prettier"

export default [
  {
    files: ["**/*.ts", "**/*.tsx"],
  },
  {
    plugins: {
      "@typescript-eslint": typescriptEslint.plugin,
    },

    languageOptions: {
      parser: typescriptEslint.parser,
      ecmaVersion: 2022,
      sourceType: "module",
    },

    rules: {
      "@typescript-eslint/naming-convention": [
        "warn",
        {
          selector: "import",
          format: ["camelCase", "PascalCase"],
        },
      ],

      curly: "warn",
      eqeqeq: "warn",
      "no-throw-literal": "warn",
      "max-lines": ["error", 3000],
      complexity: ["error", 20],
    },
  },

  // ── Complexity exceptions ─────────────────────────────────────────
  // Existing complexity violations are capped at their current max.
  // New code must stay ≤ 20. Do not raise complexity caps; refactor instead.
  {
    files: ["src/KiloProvider.ts"],
    // This is the extension integration surface; do not gate feature work on line-count churn.
    rules: { complexity: ["error", 150], "max-lines": "off" },
  },
  {
    files: ["webview-ui/agent-manager/AgentManagerApp.tsx"],
    // Was 2800; main grew to ~2830 after recent Agent Manager work. Cap tracks
    // current size (rounded up). Prefer extracting over further raises.
    rules: { complexity: ["error", 74], "max-lines": ["error", 2850] },
  },
  {
    files: ["src/agent-manager/AgentManagerProvider.ts"],
    rules: { complexity: ["error", 64] },
  },
  {
    files: ["webview-ui/src/components/chat/PromptInput.tsx"],
    rules: { complexity: ["error", 48] },
  },
  {
    files: ["src/legacy-migration/migration-service.ts"],
    rules: { complexity: ["error", 45] },
  },
  {
    files: ["webview-ui/src/components/migration/MigrationWizard.tsx"],
    rules: { complexity: ["error", 37] },
  },
  {
    files: ["webview-ui/src/context/session.tsx"],
    // Raised past 3100 after upstream/session growth (~3125). Cap tracks current
    // size (rounded up). Prefer extracting over further raises.
    rules: { complexity: ["error", 31], "max-lines": ["error", 3150] },
  },
  {
    files: ["src/services/autocomplete/classic-auto-complete/AutocompleteInlineCompletionProvider.ts"],
    rules: { complexity: ["error", 30] },
  },
  {
    files: ["src/agent-manager/WorktreeManager.ts", "webview-ui/src/components/chat/QuestionDock.tsx"],
    rules: { complexity: ["error", 28] },
  },
  {
    files: [
      "src/kilo-provider-utils.ts",
      "src/services/autocomplete/continuedev/core/autocomplete/postprocessing/index.ts",
    ],
    rules: { complexity: ["error", 27] },
  },
  {
    files: ["src/agent-manager/WorktreeStateManager.ts"],
    rules: { complexity: ["error", 24] },
  },
  {
    files: ["webview-ui/src/utils/errorUtils.ts"],
    rules: { complexity: ["error", 23] },
  },
  {
    files: ["src/services/autocomplete/continuedev/core/autocomplete/filtering/BracketMatchingService.ts"],
    rules: { complexity: ["error", 22] },
  },
  {
    files: ["webview-ui/src/context/server.tsx"],
    rules: { complexity: ["error", 21] },
  },

  eslintConfigPrettier,
]
