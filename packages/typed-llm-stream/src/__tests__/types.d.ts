// Global Jest types for tests
declare global {
	// Jest test functions
	function describe(name: string, fn: () => void): void
	function beforeEach(fn: () => void): void
	function afterEach(fn: () => void): void
	function test(name: string, fn: () => void | Promise<void>): void
	function expect(value: any): any

	// Jest namespace
	namespace jest {
		function fn(): any
		interface Matchers<R> {
			toBeInstanceOf(expected: any): R
			toBe(expected: any): R
			toEqual(expected: any): R
			toHaveLength(expected: number): R
			toHaveBeenCalled(): R
			toHaveBeenCalledTimes(expected: number): R
			toBeDefined(): R
			toBeGreaterThan(expected: number): R
			toThrow(): R
			toContain(expected: string): R
			toHaveProperty(expected: string): R
		}
	}
}

// This is needed to make it a module
export {}
