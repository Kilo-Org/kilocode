// Mock implementation of execa
const mockExeca = jest.fn().mockImplementation((command, args) => {
	return Promise.resolve({
		stdout: `Mocked execution of: ${command} ${args ? args.join(" ") : ""}`,
		stderr: "",
		exitCode: 0,
	})
})

mockExeca.sync = jest.fn().mockImplementation((command, args) => {
	return {
		stdout: `Mocked sync execution of: ${command} ${args ? args.join(" ") : ""}`,
		stderr: "",
		exitCode: 0,
	}
})

module.exports = {
	execa: mockExeca,
	execaSync: mockExeca.sync,
}
