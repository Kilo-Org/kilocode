import { XMLParser } from "fast-xml-parser"

const XML_ENTITIES: Record<string, string> = {
	"&": "&amp;",
	"<": "&lt;",
	">": "&gt;",
	'"': "&quot;",
	"'": "&apos;",
}

export function decodeSelectedXmlEntities(str: string, targets: string[] = ["&"]): string {
	let result = str

	for (const char of targets) {
		const entity = XML_ENTITIES[char]
		if (entity) {
			result = result.replace(new RegExp(entity, "g"), char)
		}
	}

	return result
}

export function parseXml(xmlString: string, stopNodes?: string[]): unknown {
	const _stopNodes = stopNodes ?? []
	try {
		const parser = new XMLParser({
			ignoreAttributes: false,
			attributeNamePrefix: "@_",
			parseAttributeValue: true,
			parseTagValue: true,
			trimValues: true,
			stopNodes: _stopNodes,
		})

		return parser.parse(xmlString)
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : "Unknown error"
		throw new Error(`Failed to parse XML: ${errorMessage}`)
	}
}
