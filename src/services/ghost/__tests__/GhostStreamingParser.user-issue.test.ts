import { sanitizeXMLConservative } from "../GhostStreamingParser"

describe("sanitizeXMLConservative - User Issue Fix", () => {
	it("should fix the exact user issue: incomplete </change tag", () => {
		// This is the exact XML from the user's issue
		const userIssueXML = `<change><search><![CDATA[function mutliply(<<<AUTOCOMPLETE_HERE>>>>
]]></search><replace><![CDATA[function mutliply(a, b) {
]]></replace></change`

		const sanitized = sanitizeXMLConservative(userIssueXML)

		// Verify the closing tag was added
		expect(sanitized).toContain("</change>")
		expect(sanitized).toBe(`<change><search><![CDATA[function mutliply(<<<AUTOCOMPLETE_HERE>>>>
]]></search><replace><![CDATA[function mutliply(a, b) {
]]></replace></change>`)
	})

	it("should handle XML completely missing the closing >", () => {
		// Even more broken XML - missing the final ">" entirely
		const brokenXML = `<change><search><![CDATA[function mutliply(<<<AUTOCOMPLETE_HERE>>>>
]]></search><replace><![CDATA[function mutliply(a, b) {
]]></replace></change`

		const sanitized = sanitizeXMLConservative(brokenXML)

		// Should fix the incomplete tag
		expect(sanitized).toContain("</change>")
		expect(sanitized).toBe(`<change><search><![CDATA[function mutliply(<<<AUTOCOMPLETE_HERE>>>>
]]></search><replace><![CDATA[function mutliply(a, b) {
]]></replace></change>`)
	})

	it("should not modify already complete XML", () => {
		const completeXML = `<change><search><![CDATA[function mutliply(<<<AUTOCOMPLETE_HERE>>>>
]]></search><replace><![CDATA[function mutliply(a, b) {
]]></replace></change>`

		const sanitized = sanitizeXMLConservative(completeXML)

		// Should remain unchanged
		expect(sanitized).toBe(completeXML)
	})

	it("should fix malformed CDATA sections", () => {
		const malformedCDATA = `<change><search><![CDATA[test content</![CDATA[</search><replace><![CDATA[new content]]></replace></change>`

		const sanitized = sanitizeXMLConservative(malformedCDATA)

		// Should replace </![CDATA[ with ]]>
		expect(sanitized).toContain("]]>")
		expect(sanitized).not.toContain("</![CDATA[")
	})

	it("should not add closing tag when stream is incomplete (ends with <)", () => {
		const incompleteStream = `<change><search><![CDATA[test]]></search><replace><![CDATA[new]]></replace><`

		const sanitized = sanitizeXMLConservative(incompleteStream)

		// Should not add closing tag when clearly in the middle of streaming
		expect(sanitized).toBe(incompleteStream)
	})

	it("should not modify XML with multiple changes", () => {
		const multipleChanges = `<change><search><![CDATA[test1]]></search><replace><![CDATA[new1]]></replace></change><change><search><![CDATA[test2]]></search><replace><![CDATA[new2]]></replace></change>`

		const sanitized = sanitizeXMLConservative(multipleChanges)

		// Should remain unchanged when multiple complete changes exist
		expect(sanitized).toBe(multipleChanges)
	})

	it("should only fix when search and replace are complete", () => {
		const incompleteSearchReplace = `<change><search><![CDATA[test]]></search><replace><![CDATA[new`

		const sanitized = sanitizeXMLConservative(incompleteSearchReplace)

		// Should not add closing tag when search/replace are incomplete
		expect(sanitized).toBe(incompleteSearchReplace)
	})
})
