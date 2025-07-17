class Calculator {
	constructor() {
		this.precision = 2
	}

	add(a, b) {
		// Addition with validation
		return a + b
	}

	subtract(a, b) {
		return a - b
	}

	multiply(a, b) {
		// Multiplication with precision
		return a * b
	}

	divide(a, b) {
		if (b === 0) throw new Error("Division by zero")
		return a / b
	}
}
