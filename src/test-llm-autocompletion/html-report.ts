import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"
import { testCases, TestCase, ContextFile } from "./test-cases.js"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const OUTPUT_DIR = path.join(__dirname, "html-output")
const APPROVALS_DIR = path.join(__dirname, "approvals")
const CURSOR_MARKER = "<<<AUTOCOMPLETE_HERE>>>"

interface ApprovalFile {
	filename: string
	type: "approved" | "rejected"
	number: number
	content: string
}

interface ParsedApprovalContent {
	prefix: string
	completion: string
	suffix: string
}

/**
 * Parse an approval content to extract prefix, completion, and suffix
 * by comparing with the original input that contains the cursor marker.
 */
function parseApprovalContent(input: string, approvalContent: string): ParsedApprovalContent {
	const cursorIndex = input.indexOf(CURSOR_MARKER)
	if (cursorIndex === -1) {
		// No cursor marker found, treat entire content as completion
		return { prefix: "", completion: approvalContent, suffix: "" }
	}

	const inputPrefix = input.substring(0, cursorIndex)
	const inputSuffix = input.substring(cursorIndex + CURSOR_MARKER.length)

	// The approval content should start with the prefix and end with the suffix
	// The completion is what's in between
	const trimmedPrefix = inputPrefix.trimEnd()
	const trimmedSuffix = inputSuffix.trimStart()

	// Find where the prefix ends in the approval content
	// We need to handle the case where whitespace might differ slightly
	let prefixEndIndex = 0
	if (trimmedPrefix.length > 0) {
		// Find the prefix in the approval content
		const prefixIndex = approvalContent.indexOf(trimmedPrefix)
		if (prefixIndex === 0) {
			prefixEndIndex = trimmedPrefix.length
		}
	}

	// Find where the suffix starts in the approval content
	let suffixStartIndex = approvalContent.length
	if (trimmedSuffix.length > 0) {
		// Find the suffix in the approval content (search from the end)
		const suffixIndex = approvalContent.lastIndexOf(trimmedSuffix)
		if (suffixIndex !== -1 && suffixIndex >= prefixEndIndex) {
			suffixStartIndex = suffixIndex
		}
	}

	return {
		prefix: approvalContent.substring(0, prefixEndIndex),
		completion: approvalContent.substring(prefixEndIndex, suffixStartIndex),
		suffix: approvalContent.substring(suffixStartIndex),
	}
}

/**
 * Format approval content with prefix/suffix in grey and completion highlighted
 */
function formatApprovalContent(input: string, approvalContent: string): string {
	const { prefix, completion, suffix } = parseApprovalContent(input, approvalContent)

	const escapedPrefix = escapeHtml(prefix)
	const escapedCompletion = escapeHtml(completion)
	const escapedSuffix = escapeHtml(suffix)

	// Wrap prefix and suffix in grey spans, completion stays normal
	let result = ""
	if (escapedPrefix) {
		result += `<span class="context-code">${escapedPrefix}</span>`
	}
	if (escapedCompletion) {
		result += `<span class="completion-code">${escapedCompletion}</span>`
	}
	if (escapedSuffix) {
		result += `<span class="context-code">${escapedSuffix}</span>`
	}

	return result || escapeHtml(approvalContent)
}

interface TestCaseWithApprovals extends TestCase {
	approvals: ApprovalFile[]
}

function loadApprovals(category: string, testName: string): ApprovalFile[] {
	const categoryDir = path.join(APPROVALS_DIR, category)
	if (!fs.existsSync(categoryDir)) {
		return []
	}

	const approvals: ApprovalFile[] = []
	const pattern = new RegExp(`^${testName}\\.(approved|rejected)\\.(\\d+)\\.txt$`)
	const files = fs.readdirSync(categoryDir).filter((f) => pattern.test(f))

	for (const file of files) {
		const match = file.match(pattern)
		if (match) {
			const filePath = path.join(categoryDir, file)
			const content = fs.readFileSync(filePath, "utf-8")
			approvals.push({
				filename: file,
				type: match[1] as "approved" | "rejected",
				number: parseInt(match[2], 10),
				content,
			})
		}
	}

	approvals.sort((a, b) => a.number - b.number)
	return approvals
}

function escapeHtml(text: string): string {
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#039;")
}

function highlightCursor(text: string): string {
	const escaped = escapeHtml(text)
	return escaped.replace(escapeHtml(CURSOR_MARKER), '<span class="cursor-marker">⟨CURSOR⟩</span>')
}

function generateIndexHtml(testCasesWithApprovals: TestCaseWithApprovals[]): string {
	const byCategory = new Map<string, TestCaseWithApprovals[]>()
	for (const tc of testCasesWithApprovals) {
		if (!byCategory.has(tc.category)) {
			byCategory.set(tc.category, [])
		}
		byCategory.get(tc.category)!.push(tc)
	}

	let categoriesHtml = ""
	for (const [category, cases] of byCategory) {
		let casesHtml = ""
		for (const tc of cases) {
			const approvedCount = tc.approvals.filter((a) => a.type === "approved").length
			const rejectedCount = tc.approvals.filter((a) => a.type === "rejected").length
			const statusClass =
				approvedCount > 0 && rejectedCount === 0
					? "all-approved"
					: approvedCount === 0 && rejectedCount > 0
						? "all-rejected"
						: "mixed"

			casesHtml += `
				<div class="test-case-item ${statusClass}">
					<a href="${category}/${tc.name}.html">${tc.name}</a>
					<span class="counts">
						<span class="approved-count" title="Approved">✓ ${approvedCount}</span>
						<span class="rejected-count" title="Rejected">✗ ${rejectedCount}</span>
					</span>
				</div>
			`
		}

		categoriesHtml += `
			<div class="category">
				<h2>${category}</h2>
				<div class="test-cases-list">
					${casesHtml}
				</div>
			</div>
		`
	}

	return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>LLM Autocompletion Test Cases</title>
	<style>
		* { box-sizing: border-box; }
		body {
			font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
			margin: 0;
			padding: 20px;
			background: #1e1e1e;
			color: #d4d4d4;
		}
		h1 {
			color: #569cd6;
			border-bottom: 2px solid #569cd6;
			padding-bottom: 10px;
		}
		h2 {
			color: #4ec9b0;
			margin-top: 30px;
		}
		.category {
			margin-bottom: 30px;
		}
		.test-cases-list {
			display: flex;
			flex-wrap: wrap;
			gap: 10px;
		}
		.test-case-item {
			background: #2d2d2d;
			padding: 10px 15px;
			border-radius: 5px;
			display: flex;
			align-items: center;
			gap: 15px;
			border-left: 4px solid #666;
		}
		.test-case-item.all-approved { border-left-color: #4caf50; }
		.test-case-item.all-rejected { border-left-color: #f44336; }
		.test-case-item.mixed { border-left-color: #ff9800; }
		.test-case-item a {
			color: #9cdcfe;
			text-decoration: none;
		}
		.test-case-item a:hover {
			text-decoration: underline;
		}
		.counts {
			display: flex;
			gap: 10px;
			font-size: 0.85em;
		}
		.approved-count { color: #4caf50; }
		.rejected-count { color: #f44336; }
		.summary {
			background: #2d2d2d;
			padding: 15px 20px;
			border-radius: 5px;
			margin-bottom: 20px;
		}
		.summary-stats {
			display: flex;
			gap: 30px;
		}
		.stat {
			display: flex;
			flex-direction: column;
		}
		.stat-value {
			font-size: 2em;
			font-weight: bold;
		}
		.stat-label {
			color: #888;
		}
	</style>
</head>
<body>
	<h1>LLM Autocompletion Test Cases</h1>
	
	<div class="summary">
		<div class="summary-stats">
			<div class="stat">
				<span class="stat-value">${testCasesWithApprovals.length}</span>
				<span class="stat-label">Test Cases</span>
			</div>
			<div class="stat">
				<span class="stat-value approved-count">${testCasesWithApprovals.reduce((sum, tc) => sum + tc.approvals.filter((a) => a.type === "approved").length, 0)}</span>
				<span class="stat-label">Approved Outputs</span>
			</div>
			<div class="stat">
				<span class="stat-value rejected-count">${testCasesWithApprovals.reduce((sum, tc) => sum + tc.approvals.filter((a) => a.type === "rejected").length, 0)}</span>
				<span class="stat-label">Rejected Outputs</span>
			</div>
		</div>
	</div>

	${categoriesHtml}
</body>
</html>`
}

function generateTestCaseHtml(tc: TestCaseWithApprovals, allTestCases: TestCaseWithApprovals[]): string {
	const sameCategoryTests = allTestCases.filter((t) => t.category === tc.category)
	const currentIndex = sameCategoryTests.findIndex((t) => t.name === tc.name)
	const prevTest = currentIndex > 0 ? sameCategoryTests[currentIndex - 1] : null
	const nextTest = currentIndex < sameCategoryTests.length - 1 ? sameCategoryTests[currentIndex + 1] : null

	const approvedOutputs = tc.approvals.filter((a) => a.type === "approved")
	const rejectedOutputs = tc.approvals.filter((a) => a.type === "rejected")

	let approvalsHtml = ""

	if (approvedOutputs.length > 0) {
		let approvedItems = ""
		for (const approval of approvedOutputs) {
			approvedItems += `
				<div class="approval-item approved">
					<div class="approval-header">
						<span class="approval-badge approved">✓ Approved #${approval.number}</span>
						<span class="approval-filename">${approval.filename}</span>
					</div>
					<pre class="code-block">${formatApprovalContent(tc.input, approval.content)}</pre>
				</div>
			`
		}
		approvalsHtml += `
			<div class="approvals-section">
				<h3 class="approved-header">Approved Outputs (${approvedOutputs.length})</h3>
				${approvedItems}
			</div>
		`
	}

	if (rejectedOutputs.length > 0) {
		let rejectedItems = ""
		for (const rejection of rejectedOutputs) {
			rejectedItems += `
				<div class="approval-item rejected">
					<div class="approval-header">
						<span class="approval-badge rejected">✗ Rejected #${rejection.number}</span>
						<span class="approval-filename">${rejection.filename}</span>
					</div>
					<pre class="code-block">${formatApprovalContent(tc.input, rejection.content)}</pre>
				</div>
			`
		}
		approvalsHtml += `
			<div class="approvals-section">
				<h3 class="rejected-header">Rejected Outputs (${rejectedOutputs.length})</h3>
				${rejectedItems}
			</div>
		`
	}

	if (tc.approvals.length === 0) {
		approvalsHtml = `<div class="no-approvals">No approvals or rejections recorded yet.</div>`
	}

	let contextFilesHtml = ""
	if (tc.contextFiles.length > 0) {
		let contextItems = ""
		for (const cf of tc.contextFiles) {
			contextItems += `
				<div class="context-file">
					<div class="context-file-header">${escapeHtml(cf.filepath)}</div>
					<pre class="code-block">${escapeHtml(cf.content)}</pre>
				</div>
			`
		}
		contextFilesHtml = `
			<div class="context-files-section">
				<h3>Context Files</h3>
				${contextItems}
			</div>
		`
	}

	return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>${tc.category}/${tc.name} - LLM Autocompletion Test</title>
	<style>
		* { box-sizing: border-box; }
		body {
			font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
			margin: 0;
			padding: 0;
			background: #1e1e1e;
			color: #d4d4d4;
			height: 100vh;
			display: flex;
			flex-direction: column;
		}
		.header {
			background: #252526;
			padding: 15px 20px;
			border-bottom: 1px solid #3c3c3c;
			display: flex;
			justify-content: space-between;
			align-items: center;
			flex-shrink: 0;
		}
		.header h1 {
			margin: 0;
			font-size: 1.2em;
			color: #569cd6;
		}
		.nav {
			display: flex;
			gap: 10px;
		}
		.nav a {
			color: #9cdcfe;
			text-decoration: none;
			padding: 5px 10px;
			background: #3c3c3c;
			border-radius: 3px;
		}
		.nav a:hover {
			background: #4c4c4c;
		}
		.nav a.disabled {
			color: #666;
			pointer-events: none;
		}
		.breadcrumb {
			color: #888;
			font-size: 0.9em;
		}
		.breadcrumb a {
			color: #9cdcfe;
			text-decoration: none;
		}
		.breadcrumb a:hover {
			text-decoration: underline;
		}
		.main-content {
			display: flex;
			flex: 1;
			overflow: hidden;
		}
		.panel {
			flex: 1;
			overflow-y: auto;
			padding: 20px;
			border-right: 1px solid #3c3c3c;
		}
		.panel:last-child {
			border-right: none;
		}
		.panel h2 {
			margin-top: 0;
			color: #4ec9b0;
			font-size: 1.1em;
			border-bottom: 1px solid #3c3c3c;
			padding-bottom: 10px;
		}
		.panel h3 {
			font-size: 1em;
			margin-top: 20px;
		}
		.approved-header { color: #4caf50; }
		.rejected-header { color: #f44336; }
		.meta-info {
			background: #2d2d2d;
			padding: 10px 15px;
			border-radius: 5px;
			margin-bottom: 15px;
		}
		.meta-row {
			display: flex;
			margin-bottom: 5px;
		}
		.meta-label {
			color: #888;
			width: 100px;
			flex-shrink: 0;
		}
		.meta-value {
			color: #ce9178;
		}
		.code-block {
			background: #1e1e1e;
			border: 1px solid #3c3c3c;
			border-radius: 5px;
			padding: 15px;
			overflow-x: auto;
			font-family: 'Fira Code', 'Consolas', 'Monaco', monospace;
			font-size: 13px;
			line-height: 1.5;
			white-space: pre-wrap;
			word-wrap: break-word;
		}
		.cursor-marker {
			background: #ffeb3b;
			color: #000;
			padding: 2px 6px;
			border-radius: 3px;
			font-weight: bold;
		}
		.approval-item {
			margin-bottom: 20px;
			border: 1px solid #3c3c3c;
			border-radius: 5px;
			overflow: hidden;
		}
		.approval-item.approved {
			border-color: #4caf50;
		}
		.approval-item.rejected {
			border-color: #f44336;
		}
		.approval-header {
			background: #2d2d2d;
			padding: 8px 12px;
			display: flex;
			justify-content: space-between;
			align-items: center;
		}
		.approval-badge {
			padding: 3px 8px;
			border-radius: 3px;
			font-size: 0.85em;
			font-weight: bold;
		}
		.approval-badge.approved {
			background: #1b5e20;
			color: #4caf50;
		}
		.approval-badge.rejected {
			background: #b71c1c;
			color: #f44336;
		}
		.approval-filename {
			color: #888;
			font-size: 0.85em;
		}
		.approval-item .code-block {
			border: none;
			border-radius: 0;
			margin: 0;
		}
		.no-approvals {
			color: #888;
			font-style: italic;
			padding: 20px;
			text-align: center;
		}
		.context-file {
			margin-bottom: 15px;
		}
		.context-file-header {
			background: #2d2d2d;
			padding: 8px 12px;
			border-radius: 5px 5px 0 0;
			border: 1px solid #3c3c3c;
			border-bottom: none;
			color: #dcdcaa;
			font-family: monospace;
		}
		.context-file .code-block {
			border-radius: 0 0 5px 5px;
			margin-top: 0;
		}
		.approvals-section {
			margin-bottom: 30px;
		}
		.keyboard-hint {
			position: fixed;
			bottom: 20px;
			right: 20px;
			background: #2d2d2d;
			padding: 10px 15px;
			border-radius: 5px;
			font-size: 0.85em;
			color: #888;
		}
		.keyboard-hint kbd {
			background: #3c3c3c;
			padding: 2px 6px;
			border-radius: 3px;
			margin: 0 3px;
		}
		.context-code {
			color: #6a6a6a;
		}
		.completion-code {
			color: #d4d4d4;
		}
	</style>
</head>
<body>
	<div class="header">
		<div>
			<div class="breadcrumb">
				<a href="../index.html">Home</a> / ${tc.category} / ${tc.name}
			</div>
			<h1>${tc.description}</h1>
		</div>
		<div class="nav">
			<a href="${prevTest ? prevTest.name + ".html" : "#"}" class="${prevTest ? "" : "disabled"}" id="prev-link">← Previous</a>
			<a href="../index.html">Index</a>
			<a href="${nextTest ? nextTest.name + ".html" : "#"}" class="${nextTest ? "" : "disabled"}" id="next-link">Next →</a>
		</div>
	</div>

	<div class="main-content">
		<div class="panel" style="flex: 0.4;">
			<h2>Input</h2>
			<div class="meta-info">
				<div class="meta-row">
					<span class="meta-label">Filename:</span>
					<span class="meta-value">${escapeHtml(tc.filename)}</span>
				</div>
				<div class="meta-row">
					<span class="meta-label">Category:</span>
					<span class="meta-value">${escapeHtml(tc.category)}</span>
				</div>
			</div>
			<pre class="code-block">${highlightCursor(tc.input)}</pre>
			${contextFilesHtml}
		</div>
		<div class="panel" style="flex: 0.6;">
			<h2>Outputs (${tc.approvals.length} total)</h2>
			${approvalsHtml}
		</div>
	</div>

	<div class="keyboard-hint">
		<kbd>←</kbd> Previous <kbd>→</kbd> Next <kbd>H</kbd> Home
	</div>

	<script>
		document.addEventListener('keydown', (e) => {
			if (e.key === 'ArrowLeft') {
				const prev = document.getElementById('prev-link');
				if (prev && !prev.classList.contains('disabled')) {
					prev.click();
				}
			} else if (e.key === 'ArrowRight') {
				const next = document.getElementById('next-link');
				if (next && !next.classList.contains('disabled')) {
					next.click();
				}
			} else if (e.key === 'h' || e.key === 'H') {
				window.location.href = '../index.html';
			}
		});
	</script>
</body>
</html>`
}

export async function generateHtmlReport(): Promise<void> {
	console.log("\n📊 Generating HTML Report...\n")
	console.log("Loading test cases...")

	// Load approvals for each test case
	const testCasesWithApprovals: TestCaseWithApprovals[] = testCases.map((tc) => ({
		...tc,
		approvals: loadApprovals(tc.category, tc.name),
	}))

	console.log(`Found ${testCasesWithApprovals.length} test cases`)

	// Create output directory
	if (fs.existsSync(OUTPUT_DIR)) {
		fs.rmSync(OUTPUT_DIR, { recursive: true })
	}
	fs.mkdirSync(OUTPUT_DIR, { recursive: true })

	// Generate index.html
	console.log("Generating index.html...")
	const indexHtml = generateIndexHtml(testCasesWithApprovals)
	fs.writeFileSync(path.join(OUTPUT_DIR, "index.html"), indexHtml)

	// Generate individual test case pages
	const categories = new Set(testCasesWithApprovals.map((tc) => tc.category))
	for (const category of categories) {
		const categoryDir = path.join(OUTPUT_DIR, category)
		fs.mkdirSync(categoryDir, { recursive: true })
	}

	for (const tc of testCasesWithApprovals) {
		console.log(`Generating ${tc.category}/${tc.name}.html...`)
		const html = generateTestCaseHtml(tc, testCasesWithApprovals)
		fs.writeFileSync(path.join(OUTPUT_DIR, tc.category, `${tc.name}.html`), html)
	}

	console.log(`\n✅ Done! Generated ${testCasesWithApprovals.length + 1} HTML files in ${OUTPUT_DIR}`)
	console.log(`\nOpen ${path.join(OUTPUT_DIR, "index.html")} in your browser to view the report.`)
}
