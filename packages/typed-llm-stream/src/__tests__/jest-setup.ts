// Add any global setup for tests here
// Make Jest types available globally
import "jest"

// Add custom matchers
declare global {
	namespace jest {
		interface Matchers<R> {
			toBeInstanceOf(expected: any): R
		}
	}
}

// Add a dummy test to avoid the "Your test suite must contain at least one test" warning
test("jest-setup dummy test", () => {
	expect(true).toBe(true)
})
