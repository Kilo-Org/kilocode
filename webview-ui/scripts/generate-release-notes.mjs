#!/usr/bin/env node

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

console.log('🚀 Starting changelog parsing...')

// Paths
const changelogPath = path.resolve(__dirname, '../../CHANGELOG.md')
const outputDir = path.resolve(__dirname, '../src/generated/releases')

console.log('📖 Reading changelog from:', changelogPath)
console.log('📁 Output directory:', outputDir)

// Check if changelog exists
if (!fs.existsSync(changelogPath)) {
    console.error('❌ Changelog not found at:', changelogPath)
    process.exit(1)
}

// Read changelog
const changelogContent = fs.readFileSync(changelogPath, 'utf-8')
console.log('📄 Changelog loaded, length:', changelogContent.length, 'characters')

// Parse releases
const releases = []
const versionPattern = /^## \[v(\d+\.\d+\.\d+)\]/gm
let match

while ((match = versionPattern.exec(changelogContent)) !== null) {
    const version = match[1]
    const startIndex = match.index

    // Find next version or end of file
    versionPattern.lastIndex = startIndex + 1
    const nextMatch = versionPattern.exec(changelogContent)
    versionPattern.lastIndex = match.index + match[0].length // Reset for next iteration

    const endIndex = nextMatch ? nextMatch.index : changelogContent.length
    const sectionContent = changelogContent.slice(startIndex, endIndex)

    // Parse the section
    const lines = sectionContent.split('\n')
    const rawChanges = []

    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim()
        if (line.startsWith('- ')) {
            // Extract basic info
            const item = {
                description: line.replace(/^- /, '').trim(),
                category: 'other'
            }

            // Extract PR number
            const prMatch = line.match(/\[#(\d+)\]/)
            if (prMatch) {
                item.prNumber = parseInt(prMatch[1])
            }

            // Extract commit hash
            const commitMatch = line.match(/\[`([a-f0-9]+)`\]/)
            if (commitMatch) {
                item.commitHash = commitMatch[1]
            }

            // Extract author
            const authorMatch = line.match(/Thanks \[@(\w+)\]/)
            if (authorMatch) {
                item.author = authorMatch[1]
            }

            // Extract description after "! - "
            const descMatch = line.match(/! - (.+)$/)
            if (descMatch) {
                item.description = descMatch[1].trim()
            }

            rawChanges.push(item)
        }
    }

    if (rawChanges.length > 0) {
        const release = {
            version,
            features: [],
            fixes: [],
            improvements: [],
            breakingChanges: [],
            rawChanges
        }

        // Simple categorization
        rawChanges.forEach(item => {
            const desc = item.description.toLowerCase()
            if (desc.includes('fix') || desc.includes('bug')) {
                item.category = 'fix'
                release.fixes.push(item)
            } else if (desc.includes('break')) {
                item.category = 'breaking'
                release.breakingChanges.push(item)
            } else if (desc.includes('add') || desc.includes('new')) {
                item.category = 'feature'
                release.features.push(item)
            } else if (desc.includes('improve') || desc.includes('update')) {
                item.category = 'improvement'
                release.improvements.push(item)
            }
        })

        releases.push(release)
        console.log(`📝 Parsed release v${version} with ${rawChanges.length} changes`)
    }
}

console.log(`✅ Found ${releases.length} releases`)

// Limit to the last 10 releases to keep build size manageable
const MAX_RELEASES = 10
const limitedReleases = releases.slice(0, MAX_RELEASES)
console.log(`🔢 Limiting to ${limitedReleases.length} most recent releases (from ${releases.length} total)`)

// Create output directory
if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true })
    console.log('📁 Created output directory')
}

// Generate single releases.json file with current version and recent releases
const releaseData = {
    currentVersion: limitedReleases[0]?.version || "0.0.0",
    releases: limitedReleases
}

const releasesPath = path.join(outputDir, 'releases.json')
fs.writeFileSync(releasesPath, JSON.stringify(releaseData, null, 2))
console.log(`💾 Generated releases.json with ${limitedReleases.length} releases`)
console.log(`📋 Current version: ${releaseData.currentVersion}`)

console.log('🎉 Changelog parsing completed successfully!')
