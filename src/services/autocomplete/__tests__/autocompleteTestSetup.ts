// This file should be imported at the top of test files
// It sets up common mocks used in tests

// Mock the vscode module
jest.mock("vscode", () => ({
	Position: class {
		constructor(
			public line: number,
			public character: number,
		) {
			this.line = line
			this.character = character
		}

		translate(lineDelta: number, characterDelta: number): any {
			return new (jest.requireMock("vscode").Position)(this.line + lineDelta, this.character + characterDelta)
		}
	},
	Range: class {
		constructor(
			public start: any,
			public end: any,
		) {
			this.start = start
			this.end = end
		}
	},
	InlineCompletionItem: class {
		constructor(
			public text: string,
			public range: any,
		) {
			this.text = text
			this.range = range
		}
	},
	EndOfLine: {
		LF: 1,
		CRLF: 2,
	},
}))
