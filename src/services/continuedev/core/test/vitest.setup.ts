import { TextDecoder, TextEncoder } from "util"
import { beforeAll } from "vitest"

beforeAll(async () => {
	const g: any = globalThis

	// Node 20+ provides global fetch/Request/Response natively
	// Set up TextEncoder/TextDecoder for tests
	g.TextEncoder = TextEncoder
	g.TextDecoder = TextDecoder
})
