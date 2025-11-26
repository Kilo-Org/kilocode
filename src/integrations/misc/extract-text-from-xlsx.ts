// kilocode_change start - use SheetJS to extract text from XLSX files with improved cell handling
import * as XLSX from "xlsx"

const ROW_LIMIT = 50000

function formatCellValue(cell: XLSX.CellObject | undefined): string {
	if (!cell) {
		return ""
	}

	// Handle formulas first (before checking for null values)
	// This allows formulas without calculated results to be displayed
	if (cell.f) {
		if (cell.w !== undefined && cell.w !== null) {
			return cell.w
		} else if (cell.v !== undefined && cell.v !== null) {
			return cell.v.toString()
		} else {
			return `[Formula: ${cell.f}]`
		}
	}

	// Now check for null/undefined values
	if (cell.v === null || cell.v === undefined) {
		return ""
	}

	// Handle error values (#DIV/0!, #N/A, etc.)
	if (cell.t === "e") {
		return `[Error: ${cell.w || cell.v}]`
	}

	// Handle dates - SheetJS stores dates as numbers (Excel serial dates)
	// Check if it's a date by looking at the number format or if cellDates was used
	if (cell.t === "d") {
		// Date object (when cellDates: true was used)
		const date = cell.v as Date
		return date.toISOString().split("T")[0]
	} else if (cell.t === "n" && cell.w && isDateFormat(cell.z)) {
		// Number with date format - parse the formatted value or convert from serial
		try {
			const date = XLSX.SSF.parse_date_code(cell.v as number)
			return `${date.y}-${String(date.m).padStart(2, "0")}-${String(date.d).padStart(2, "0")}`
		} catch {
			// If date parsing fails, use formatted value
			return cell.w
		}
	}

	// Handle rich text
	if (cell.r && Array.isArray(cell.r)) {
		return cell.r.map((rt: any) => rt.t || "").join("")
	}

	// Handle hyperlinks
	if (cell.l && cell.l.Target) {
		const text = cell.w || cell.v?.toString() || ""
		return `${text} (${cell.l.Target})`
	}

	// Default: use formatted value if available, otherwise raw value
	return cell.w || cell.v?.toString() || ""
}

// Helper function to check if a number format represents a date
function isDateFormat(fmt: string | number | undefined): boolean {
	if (!fmt) return false
	// Convert to string if it's a number (format index)
	const fmtStr = typeof fmt === "number" ? fmt.toString() : fmt
	// Common date format indicators
	const dateIndicators = ["d", "m", "y", "h", "s"]
	const lowerFmt = fmtStr.toLowerCase()
	return dateIndicators.some((indicator) => lowerFmt.includes(indicator))
}

export async function extractTextFromXLSX(filePathOrWorkbook: string | XLSX.WorkBook): Promise<string> {
	let workbook: XLSX.WorkBook
	let excelText = ""

	if (typeof filePathOrWorkbook === "string") {
		workbook = XLSX.readFile(filePathOrWorkbook, { cellDates: true })
	} else {
		workbook = filePathOrWorkbook
	}

	// Get sheet names
	const sheetNames = workbook.SheetNames

	sheetNames.forEach((sheetName: string, sheetIndex: number) => {
		const worksheet = workbook.Sheets[sheetName]

		// Check if sheet is hidden
		if (workbook.Workbook && workbook.Workbook.Sheets && workbook.Workbook.Sheets[sheetIndex]) {
			const sheetInfo = workbook.Workbook.Sheets[sheetIndex]
			// Hidden property: 0 = visible, 1 = hidden, 2 = very hidden
			if (sheetInfo.Hidden === 1 || sheetInfo.Hidden === 2) {
				return
			}
		}

		excelText += `--- Sheet: ${sheetName} ---\n`

		// Get the range of the worksheet
		const range = XLSX.utils.decode_range(worksheet["!ref"] || "A1")

		// Iterate through rows
		for (let rowNum = range.s.r; rowNum <= range.e.r && rowNum < ROW_LIMIT; rowNum++) {
			const rowTexts: string[] = []
			let hasContent = false

			// Iterate through columns
			for (let colNum = range.s.c; colNum <= range.e.c; colNum++) {
				const cellAddress = XLSX.utils.encode_cell({ r: rowNum, c: colNum })
				const cell = worksheet[cellAddress]
				const cellText = formatCellValue(cell)

				if (cellText.trim()) {
					hasContent = true
				}
				rowTexts.push(cellText)
			}

			if (hasContent) {
				excelText += rowTexts.join("\t") + "\n"
			}
		}

		// Add truncation message if we hit the row limit
		if (range.e.r >= ROW_LIMIT) {
			excelText += `[... truncated at row ${ROW_LIMIT} ...]\n`
		}

		excelText += "\n"
	})

	return excelText.trim()
}
// kilocode_change end - use SheetJS to extract text from XLSX files with improved cell handling
