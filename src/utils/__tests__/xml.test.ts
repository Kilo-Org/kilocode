import { decodeSelectedXmlEntities } from "../xml"

describe("xml", () => {
	test("decodeSelectedXmlEntities", () => {
		expect(decodeSelectedXmlEntities("a &amp; b")).toBe("a & b")
		expect(decodeSelectedXmlEntities("a &lt; b")).toBe("a &lt; b")
		expect(decodeSelectedXmlEntities("a &lt; b", ["<"])).toBe("a < b")
		expect(decodeSelectedXmlEntities("a &amp; b &lt; c &gt; d", ["&", "<", ">"])).toBe("a & b < c > d")
	})
})
