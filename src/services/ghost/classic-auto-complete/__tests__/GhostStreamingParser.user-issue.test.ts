import { sanitizeXMLConservative } from "../GhostStreamingParser"

describe("sanitizeXMLConservative - User Issue Fix (Hole Filling)", () => {
	it("should fix incomplete </HOLE tag", () => {
		const userIssueXML = `<HOLE>function multiply(a, b) {
	return a * b;
}</HOLE`

		const sanitized = sanitizeXMLConservative(userIssueXML)

		// Verify the closing tag was completed
		expect(sanitized).toContain("</HOLE>")
		expect(sanitized).toBe(`<HOLE>function multiply(a, b) {
	return a * b;
}</HOLE>`)
	})

	it("should handle XML completely missing the closing tag", () => {
		const brokenXML = `<HOLE>function multiply(a, b) {
	return a * b;
}`

		const sanitized = sanitizeXMLConservative(brokenXML)

		// Should add the missing closing tag
		expect(sanitized).toContain("</HOLE>")
		expect(sanitized).toBe(`<HOLE>function multiply(a, b) {
	return a * b;
}</HOLE>`)
	})

	it("should not modify already complete XML", () => {
		const completeXML = `<HOLE>function multiply(a, b) {
	return a * b;
}</HOLE>`

		const sanitized = sanitizeXMLConservative(completeXML)

		// Should remain unchanged
		expect(sanitized).toBe(completeXML)
	})

	it("should not add closing tag when stream is incomplete (ends with <)", () => {
		const incompleteStream = `<HOLE>function multiply(a, b) {<`

		const sanitized = sanitizeXMLConservative(incompleteStream)

		// Should not add closing tag when clearly in the middle of streaming
		expect(sanitized).toBe(incompleteStream)
	})

	it("should handle empty HOLE", () => {
		const emptyHole = "<HOLE></HOLE>"
		const sanitized = sanitizeXMLConservative(emptyHole)
		expect(sanitized).toBe(emptyHole)
	})

	it("should handle HOLE with special characters", () => {
		const specialChars = `<HOLE>const regex = /test/g;
const str = "hello";</HOLE>`
		const sanitized = sanitizeXMLConservative(specialChars)
		expect(sanitized).toBe(specialChars)
	})

	it("should fix incomplete HOLE when content is complete", () => {
		const incompleteHole = `<HOLE>console.log('complete content');`
		const sanitized = sanitizeXMLConservative(incompleteHole)

		// Should add closing tag
		expect(sanitized).toBe(`<HOLE>console.log('complete content');</HOLE>`)
	})

	it("should handle case-insensitive tags", () => {
		const lowerCase = `<hole>content</hole`
		const sanitized = sanitizeXMLConservative(lowerCase)

		// Should fix incomplete closing tag (adds uppercase HOLE)
		expect(sanitized).toContain("</HOLE>")
	})

	it("should handle multiline content with incomplete tag", () => {
		const multiline = `<HOLE>line1
line2
line3</HOLE`
		const sanitized = sanitizeXMLConservative(multiline)

		expect(sanitized).toBe(`<HOLE>line1
line2
line3</HOLE>`)
	})

	it("should not modify when no HOLE tags present", () => {
		const noHole = "just some text without tags"
		const sanitized = sanitizeXMLConservative(noHole)
		expect(sanitized).toBe(noHole)
	})
})
