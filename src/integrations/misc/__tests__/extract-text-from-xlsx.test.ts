// kilocode_change start - use SheetJS to extract text from XLSX files with improved cell handling
import * as XLSX from "xlsx"
import { extractTextFromXLSX } from "../extract-text-from-xlsx"

describe("extractTextFromXLSX", () => {
	describe("basic functionality", () => {
		it("should extract text with proper formatting", async () => {
			const workbook = XLSX.utils.book_new()
			const worksheet = XLSX.utils.aoa_to_sheet([
				["Hello", "World"],
				["Test", 123],
			])
			XLSX.utils.book_append_sheet(workbook, worksheet, "Sheet1")

			const result = await extractTextFromXLSX(workbook)

			expect(result).toContain("--- Sheet: Sheet1 ---")
			expect(result).toContain("Hello\tWorld")
			expect(result).toContain("Test\t123")
		})

		it("should skip rows with no content", async () => {
			const workbook = XLSX.utils.book_new()
			const worksheet = XLSX.utils.aoa_to_sheet([
				["Row 1"],
				[], // Empty row
				["Row 3"],
			])
			XLSX.utils.book_append_sheet(workbook, worksheet, "Sheet1")

			const result = await extractTextFromXLSX(workbook)

			expect(result).toContain("Row 1")
			expect(result).toContain("Row 3")
			// Should not contain empty rows
			expect(result).not.toMatch(/\n\t*\n/)
		})
	})

	describe("sheet handling", () => {
		it("should process multiple sheets", async () => {
			const workbook = XLSX.utils.book_new()

			const sheet1 = XLSX.utils.aoa_to_sheet([["Sheet 1 Data"]])
			XLSX.utils.book_append_sheet(workbook, sheet1, "First Sheet")

			const sheet2 = XLSX.utils.aoa_to_sheet([["Sheet 2 Data"]])
			XLSX.utils.book_append_sheet(workbook, sheet2, "Second Sheet")

			const result = await extractTextFromXLSX(workbook)

			expect(result).toContain("--- Sheet: First Sheet ---")
			expect(result).toContain("Sheet 1 Data")
			expect(result).toContain("--- Sheet: Second Sheet ---")
			expect(result).toContain("Sheet 2 Data")
		})

		it("should skip hidden sheets", async () => {
			const workbook = XLSX.utils.book_new()

			const visibleSheet = XLSX.utils.aoa_to_sheet([["Visible Data"]])
			XLSX.utils.book_append_sheet(workbook, visibleSheet, "Visible Sheet")

			const hiddenSheet = XLSX.utils.aoa_to_sheet([["Hidden Data"]])
			XLSX.utils.book_append_sheet(workbook, hiddenSheet, "Hidden Sheet")

			// Mark the second sheet as hidden
			if (!workbook.Workbook) workbook.Workbook = {}
			if (!workbook.Workbook.Sheets) workbook.Workbook.Sheets = []
			workbook.Workbook.Sheets[0] = { Hidden: 0 } // Visible
			workbook.Workbook.Sheets[1] = { Hidden: 1 } // Hidden

			const result = await extractTextFromXLSX(workbook)

			expect(result).toContain("--- Sheet: Visible Sheet ---")
			expect(result).toContain("Visible Data")
			expect(result).not.toContain("--- Sheet: Hidden Sheet ---")
			expect(result).not.toContain("Hidden Data")
		})

		it("should skip very hidden sheets", async () => {
			const workbook = XLSX.utils.book_new()

			const visibleSheet = XLSX.utils.aoa_to_sheet([["Visible Data"]])
			XLSX.utils.book_append_sheet(workbook, visibleSheet, "Visible Sheet")

			const veryHiddenSheet = XLSX.utils.aoa_to_sheet([["Very Hidden Data"]])
			XLSX.utils.book_append_sheet(workbook, veryHiddenSheet, "Very Hidden Sheet")

			// Mark the second sheet as very hidden
			if (!workbook.Workbook) workbook.Workbook = {}
			if (!workbook.Workbook.Sheets) workbook.Workbook.Sheets = []
			workbook.Workbook.Sheets[0] = { Hidden: 0 } // Visible
			workbook.Workbook.Sheets[1] = { Hidden: 2 } // Very Hidden

			const result = await extractTextFromXLSX(workbook)

			expect(result).toContain("--- Sheet: Visible Sheet ---")
			expect(result).toContain("Visible Data")
			expect(result).not.toContain("--- Sheet: Very Hidden Sheet ---")
			expect(result).not.toContain("Very Hidden Data")
		})
	})

	describe("formatCellValue logic", () => {
		it("should handle null and undefined values", async () => {
			const workbook = XLSX.utils.book_new()
			const worksheet = XLSX.utils.aoa_to_sheet([["Before"], [null], [undefined], ["After"]])
			XLSX.utils.book_append_sheet(workbook, worksheet, "Sheet1")

			const result = await extractTextFromXLSX(workbook)

			expect(result).toContain("Before")
			expect(result).toContain("After")
			// Should handle null/undefined as empty strings
			const lines = result.split("\n")
			const dataLines = lines.filter((line) => !line.startsWith("---") && line.trim())
			expect(dataLines).toHaveLength(2) // Only 'Before' and 'After' should create content
		})

		it("should format dates correctly", async () => {
			const workbook = XLSX.utils.book_new()
			const worksheet: XLSX.WorkSheet = {}

			// Create a date cell manually
			const testDate = new Date("2023-12-25")
			worksheet["A1"] = {
				t: "d",
				v: testDate,
				w: testDate.toISOString(),
			}
			worksheet["!ref"] = "A1"

			XLSX.utils.book_append_sheet(workbook, worksheet, "Sheet1")

			const result = await extractTextFromXLSX(workbook)

			expect(result).toContain("2023-12-25")
		})

		it("should handle error values", async () => {
			const workbook = XLSX.utils.book_new()
			const worksheet: XLSX.WorkSheet = {}

			// Create an error cell
			worksheet["A1"] = {
				t: "e",
				v: 0x07, // #DIV/0! error code
				w: "#DIV/0!",
			}
			worksheet["!ref"] = "A1"

			XLSX.utils.book_append_sheet(workbook, worksheet, "Sheet1")

			const result = await extractTextFromXLSX(workbook)

			expect(result).toContain("[Error: #DIV/0!]")
		})

		it("should handle rich text", async () => {
			const workbook = XLSX.utils.book_new()
			const worksheet: XLSX.WorkSheet = {}

			// Create a rich text cell
			worksheet["A1"] = {
				t: "s",
				v: "Hello World",
				r: [{ t: "Hello " }, { t: "World" }],
			}
			worksheet["!ref"] = "A1"

			XLSX.utils.book_append_sheet(workbook, worksheet, "Sheet1")

			const result = await extractTextFromXLSX(workbook)

			expect(result).toContain("Hello World")
		})

		it("should handle hyperlinks", async () => {
			const workbook = XLSX.utils.book_new()
			const worksheet: XLSX.WorkSheet = {}

			// Create a hyperlink cell
			worksheet["A1"] = {
				t: "s",
				v: "Roo Code",
				w: "Roo Code",
				l: { Target: "https://roocode.com/" },
			}
			worksheet["!ref"] = "A1"

			XLSX.utils.book_append_sheet(workbook, worksheet, "Sheet1")

			const result = await extractTextFromXLSX(workbook)

			expect(result).toContain("Roo Code (https://roocode.com/)")
		})

		it("should handle formulas with and without results", async () => {
			const workbook = XLSX.utils.book_new()
			const worksheet: XLSX.WorkSheet = {}

			// Formula with result
			worksheet["A1"] = {
				t: "n",
				v: 30,
				w: "30",
				f: "A2+A3",
			}

			// Formula without result (no v or w property)
			worksheet["A2"] = {
				f: "SUM(B1:B10)",
			}

			worksheet["!ref"] = "A1:A2"

			XLSX.utils.book_append_sheet(workbook, worksheet, "Sheet1")

			const result = await extractTextFromXLSX(workbook)

			expect(result).toContain("30") // Formula with result
			expect(result).toContain("[Formula: SUM(B1:B10)]") // Formula without result
		})
	})

	describe("edge cases", () => {
		it("should handle empty workbook", async () => {
			const workbook = XLSX.utils.book_new()
			const worksheet = XLSX.utils.aoa_to_sheet([[]])
			XLSX.utils.book_append_sheet(workbook, worksheet, "Empty Sheet")

			const result = await extractTextFromXLSX(workbook)

			expect(result).toContain("--- Sheet: Empty Sheet ---")
			expect(result.trim()).toBe("--- Sheet: Empty Sheet ---")
		})

		it("should handle workbook with only empty cells", async () => {
			const workbook = XLSX.utils.book_new()
			const worksheet = XLSX.utils.aoa_to_sheet([["", ""]])
			XLSX.utils.book_append_sheet(workbook, worksheet, "Sheet1")

			const result = await extractTextFromXLSX(workbook)

			expect(result).toContain("--- Sheet: Sheet1 ---")
			// Should not contain any data rows since empty strings don't count as content
			const lines = result.split("\n").filter((line) => line.trim() && !line.startsWith("---"))
			expect(lines).toHaveLength(0)
		})
	})

	describe("function overloads", () => {
		it("should work with workbook objects", async () => {
			const workbook = XLSX.utils.book_new()
			const worksheet = XLSX.utils.aoa_to_sheet([["Test Data"]])
			XLSX.utils.book_append_sheet(workbook, worksheet, "Test")

			const result = await extractTextFromXLSX(workbook)

			expect(result).toContain("Test Data")
		})

		it("should reject invalid file paths", async () => {
			await expect(extractTextFromXLSX("/non/existent/file.xlsx")).rejects.toThrow()
		})
	})
})
// kilocode_change end - use SheetJS to extract text from XLSX files with improved cell handling
