#!/usr/bin/env node

const https = require("https")
const fs = require("fs")
const path = require("path")

const GITHUB_API_URL = "https://api.github.com/repos/Kilo-Org/kilocode/contributors?per_page=100"
const README_PATH = path.join(__dirname, "..", "README.md")

const START_MARKER = "<!-- START CONTRIBUTORS SECTION - AUTO-GENERATED, DO NOT EDIT MANUALLY -->"
const END_MARKER = "<!-- END CONTRIBUTORS SECTION -->"

const options = {
	headers: {
		"User-Agent": "Kilo-Code-Contributors-Script",
	},
}

if (process.env.GITHUB_TOKEN) {
	options.headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`
	console.log("Using GitHub token from environment variable")
}

function fetchContributors() {
	return new Promise((resolve, reject) => {
		https
			.get(GITHUB_API_URL, options, (res) => {
				if (res.statusCode !== 200) {
					reject(new Error(`GitHub API request failed with status code: ${res.statusCode}`))
					return
				}

				let data = ""
				res.on("data", (chunk) => {
					data += chunk
				})

				res.on("end", () => {
					try {
						const contributors = JSON.parse(data)
						resolve(contributors)
					} catch (error) {
						reject(new Error(`Failed to parse GitHub API response: ${error.message}`))
					}
				})
			})
			.on("error", (error) => {
				reject(new Error(`GitHub API request failed: ${error.message}`))
			})
	})
}

function readReadme() {
	return new Promise((resolve, reject) => {
		fs.readFile(README_PATH, "utf8", (err, data) => {
			if (err) {
				reject(new Error(`Failed to read README.md: ${err.message}`))
				return
			}
			resolve(data)
		})
	})
}

function formatContributorsSection(contributors) {
	const filteredContributors = contributors.filter((c) => !c.login.includes("[bot]") && !c.login.includes("R00-B0T"))

	let markdown = `${START_MARKER}

Thanks to all the contributors who help make Kilo Code better!

`
	const COLUMNS = 6

	const createCell = (contributor) => {
		return `<a href="${contributor.html_url}"><img src="${contributor.avatar_url}" width="100" height="100" alt="${contributor.login}" style="border-radius:50%"/><br /><sub><b>${contributor.login}</b></sub></a>`
	}

	if (filteredContributors.length > 0) {
		const headerCells = filteredContributors.slice(0, COLUMNS).map(createCell)

		while (headerCells.length < COLUMNS) {
			headerCells.push(" ")
		}

		markdown += `|${headerCells.join("|")}|\n`

		markdown += "|"
		for (let i = 0; i < COLUMNS; i++) {
			markdown += ":---:|"
		}
		markdown += "\n"

		for (let i = COLUMNS; i < filteredContributors.length; i += COLUMNS) {
			const rowContributors = filteredContributors.slice(i, i + COLUMNS)

			const cells = rowContributors.map(createCell)

			while (cells.length < COLUMNS) {
				cells.push(" ")
			}

			markdown += `|${cells.join("|")}|\n`
		}
	}

	markdown += `${END_MARKER}`
	return markdown
}

function updateReadme(readmeContent, contributorsSection) {
	const startPos = readmeContent.indexOf(START_MARKER)
	const endPos = readmeContent.indexOf(END_MARKER)

	if (startPos === -1 || endPos === -1) {
		console.warn("Warning: Could not find contributors section markers in README.md")
		console.warn("Skipping update - please add markers to enable automatic updates.")
		return
	}

	const beforeSection = readmeContent.substring(0, startPos).trimEnd()
	const afterSection = readmeContent.substring(endPos + END_MARKER.length).trimStart()
	const updatedContent = beforeSection + "\n\n" + contributorsSection.trim() + "\n\n" + afterSection

	return writeReadme(updatedContent)
}

function writeReadme(content) {
	return new Promise((resolve, reject) => {
		fs.writeFile(README_PATH, content, "utf8", (err) => {
			if (err) {
				reject(new Error(`Failed to write updated README.md: ${err.message}`))
				return
			}
			resolve()
		})
	})
}

async function main() {
	try {
		const contributors = await fetchContributors()

		const readmeContent = await readReadme()

		const contributorsSection = formatContributorsSection(contributors)

		await updateReadme(readmeContent, contributorsSection)
	} catch (error) {
		console.error(`Error: ${error.message}`)
		process.exit(1)
	}
}

main()
