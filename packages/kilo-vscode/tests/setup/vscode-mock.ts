/**
 * Shared vscode module mock for all Bun unit tests.
 *
 * Registered as a preload in bunfig.toml so the mock is applied ONCE before
 * any test file loads. This eliminates race conditions when multiple test
 * files each call mock.module("vscode", ...) with competing mock shapes.
 */
import { mock } from "bun:test"

const kind = (value: string): { value: string; append: (part: string) => ReturnType<typeof kind> } => ({
  value,
  append: (part: string) => kind(`${value}.${part}`),
})

const noop = () => {}

const mockUri = {
  parse: (value: string) => ({ scheme: "https", authority: "", path: value, query: "", fragment: "", fsPath: value }),
  file: (path: string) => ({ scheme: "file", authority: "", path, query: "", fragment: "", fsPath: path }),
  joinPath: (base: { fsPath: string }, ...segments: string[]) => {
    const joined = [base.fsPath, ...segments].join("/")
    return { scheme: "file", authority: "", path: joined, query: "", fragment: "", fsPath: joined }
  },
}

const mockVscode = {
  Uri: mockUri,
  extensions: {
    getExtension: (id: string) => {
      if (id === "vscode.git") return undefined
      return {
        packageJSON: { version: "test", contributes: { configuration: { properties: {} } } },
        isActive: true,
        exports: undefined,
      }
    },
  },
  env: {
    appName: "VS Code",
    language: "en",
    machineId: "test-machine",
    isTelemetryEnabled: false,
    shell: "/bin/bash",
    openExternal: noop,
  },
  version: "1.90.0",
  workspace: {
    workspaceFolders: [{ uri: { fsPath: "/repo" } }],
    getConfiguration: () => ({
      get: <T>(_key: string, value?: T) => value,
      update: async () => {},
    }),
    asRelativePath: (pathOrUri: string) => pathOrUri,
    fs: {
      createDirectory: async () => {},
      writeFile: async () => {},
      readFile: async () => new Uint8Array(),
      readDirectory: async () => [],
      delete: async () => {},
      stat: async () => ({ type: 1, ctime: 0, mtime: 0, size: 0 }),
    },
  },
  StatusBarAlignment: { Left: 1, Right: 2 },
  ThemeColor: class {
    constructor(public id: string) {}
  },
  window: {
    activeTextEditor: undefined,
    visibleTextEditors: [],
    tabGroups: { all: [] },
    showTextDocument: async () => {},
    showWarningMessage: async () => undefined,
    createTerminal: () => ({ show: noop, sendText: noop, dispose: noop }),
    createStatusBarItem: () => ({
      text: "",
      tooltip: "",
      color: undefined as unknown,
      command: undefined as string | undefined,
      show: noop,
      hide: noop,
      dispose: noop,
    }),
  },
  commands: {
    registerCommand: () => ({ dispose: noop }),
    executeCommand: async () => {},
  },
  CodeAction: class {
    command?: { command: string; title: string }
    isPreferred?: boolean
    constructor(
      public title: string,
      public kind: { value: string },
    ) {}
  },
  CodeActionKind: {
    QuickFix: kind("quickfix"),
    RefactorRewrite: kind("refactor.rewrite"),
  },
  ConfigurationTarget: {
    Global: 1,
    Workspace: 2,
    WorkspaceFolder: 3,
  },
  TabInputText: class {
    constructor(public uri: { scheme: string; fsPath: string }) {}
  },
  Position: class {
    constructor(
      public line: number,
      public character: number,
    ) {}
  },
  Range: class {
    constructor(
      public start: { line: number; character: number },
      public end: { line: number; character: number },
    ) {}
  },
  Disposable: class {
    constructor(private callback: () => void = noop) {}
    dispose() {
      this.callback()
    }
  },
  EventEmitter: class {
    event = noop
    fire = noop
    dispose = noop
  },
  TreeItem: class {
    constructor(public label: string) {}
  },
  TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
  ViewColumn: { One: 1, Two: 2, Three: 3 },
}

mock.module("vscode", () => mockVscode)
