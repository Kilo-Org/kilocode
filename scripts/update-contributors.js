#!/usr/bin/env node

import fs from "fs"
import path from "path"
import https from "https"
import { fileURLToPath } from "url"

// Configuration
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const README_FILE = path.join(__dirname, "../README.md")
const CONTRIBUTORS_JSON_URL = "https://kilo.ai/contributors.json"
const MAX_CONTRIBUTORS_DISPLAY = 9
const CONTRIBUTORS_PAGE_URL = "https://kilo.ai/#contributors"

// Function to make HTTP requests
function makeRequest(url) {
	return new Promise((resolve, reject) => {
		https
			.get(url, (res) => {
				let data = ""

				res.on("data", (chunk) => {
					data += chunk
				})

				res.on("end", () => {
					try {
						const jsonData = JSON.parse(data)
						resolve(jsonData)
					} catch (error) {
						reject(error)
					}
				})
			})
			.on("error", (error) => {
				reject(error)
			})
	})
}

// Function to generate Markdown contributor list
function generateContributorMarkdown(contributors) {
	let markdown = "## Contributors\n\n"
	markdown += "Thanks to all the contributors who help make Kilo Code better!\n\n"

	// Map the kilo.ai format to expected format
	const validContributors = contributors.map((contributor) => {
		// Convert kilo.ai format to GitHub-like format
		return {
			login: contributor.username,
			html_url: `https://github.com/${contributor.username}`,
			avatar_url: `https://avatars.githubusercontent.com/u/${contributor.avatarId}`,
		}
	})

	// Limit to MAX_CONTRIBUTORS_DISPLAY contributors
	const displayContributors = validContributors.slice(0, MAX_CONTRIBUTORS_DISPLAY)
	const hasMore = validContributors.length > MAX_CONTRIBUTORS_DISPLAY

	// Create a grid of contributor avatars in rows of 5
	let contributorGrid = "<table>\n"

	for (let i = 0; i < displayContributors.length; i++) {
		const contributor = displayContributors[i]

		// Start a new row every 5 contributors
		if (i % 5 === 0) {
			if (i > 0) {
				contributorGrid += "\n  </tr>\n"
			}
			contributorGrid += "  <tr>\n"
		}

		const contributorCell = `    <td align="center">
      <a href="${contributor.html_url}">
        <img src="${contributor.avatar_url}?size=100" width="100" height="100" alt="${contributor.login}" style="border-radius: 50%;" />
      </a>
    </td>`

		contributorGrid += contributorCell
	}

	// Add "more..." cell if there are more contributors
	if (hasMore) {
		// Check if we need to add it to current row or start new row
		const lastRowCount = displayContributors.length % 5

		if (lastRowCount === 0) {
			// Start a new row for "more..."
			contributorGrid += "\n  </tr>\n  <tr>\n"
		}

		const moreCell = `    <td align="center">
      <a href="${CONTRIBUTORS_PAGE_URL}">
        <b>more ...</b>
      </a>
    </td>`

		contributorGrid += moreCell
	}

	// Close the last row
	contributorGrid += "\n  </tr>\n</table>\n"

	markdown += contributorGrid
	return markdown
}

// Function to update the contributors section in the README
async function updateContributorsSection() {
	try {
		console.log("Fetching contributors from kilo.ai...")

		// Fetch contributors from external JSON
		const contributors = await makeRequest(CONTRIBUTORS_JSON_URL)

		if (!Array.isArray(contributors)) {
			throw new Error("Failed to fetch contributors data")
		}

		console.log(`Found ${contributors.length} contributors`)

		// Generate Markdown content
		const contributorMarkdown = generateContributorMarkdown(contributors)

		// Read the existing README
		let readmeContent = fs.readFileSync(README_FILE, "utf8")

		// Find the contributors section markers or add at the end
		const contributorsStartMarker = "## Contributors"
		const contributorsEndMarker = "<!-- END CONTRIBUTORS SECTION -->"

		let newContent

		if (readmeContent.includes(contributorsStartMarker)) {
			// Replace existing contributors section
			const startIndex = readmeContent.indexOf(contributorsStartMarker)
			const endIndex = readmeContent.indexOf(contributorsEndMarker)

			if (endIndex === -1) {
				// No end marker, look for any existing table or content after the header
				// and replace everything from the header to the end of file
				const afterHeaderIndex = startIndex + contributorsStartMarker.length
				const beforeContent = readmeContent.substring(0, startIndex)
				newContent = beforeContent + contributorMarkdown + "\n<!-- END CONTRIBUTORS SECTION -->\n"
			} else {
				// Replace between markers - clean replacement between the header and end marker
				const beforeContent = readmeContent.substring(0, startIndex)
				const afterContent = readmeContent.substring(endIndex + contributorsEndMarker.length)
				newContent = beforeContent + contributorMarkdown + "\n" + contributorsEndMarker + afterContent
			}
		} else {
			// Add contributors section at the end
			newContent = readmeContent.trim() + "\n\n" + contributorMarkdown + "\n<!-- END CONTRIBUTORS SECTION -->\n"
		}

		// Write the updated content back to the README
		fs.writeFileSync(README_FILE, newContent)

		console.log("Contributors section updated successfully!")
	} catch (error) {
		console.error("Error updating contributors section:", error.message)
		console.error("Stack trace:", error.stack)
		process.exit(1)
	}
}

// Run the script
updateContributorsSection()
