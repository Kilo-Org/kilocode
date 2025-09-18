#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import https from 'https';
import { fileURLToPath } from 'url';

// Configuration
const REPO_OWNER = 'Kilo-Org';
const REPO_NAME = 'kilocode';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const README_FILE = path.join(__dirname, '../README.md');
const GITHUB_API_URL = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contributors`;

// Function to make HTTP requests
function makeRequest(url) {
  return new Promise((resolve, reject) => {
    const options = {
      headers: {
        'User-Agent': 'Kilo-Code-Contributors-Script',
        Accept: 'application/vnd.github.v3+json',
      },
    };

    https
      .get(url, options, res => {
        let data = '';

        res.on('data', chunk => {
          data += chunk;
        });

        res.on('end', () => {
          try {
            const jsonData = JSON.parse(data);
            resolve(jsonData);
          } catch (error) {
            reject(error);
          }
        });
      })
      .on('error', error => {
        reject(error);
      });
  });
}

// Function to check if a user is a bot
function isBotUser(username) {
  const botIndicators = ['bot', 'dependabot', 'renovate', 'github-actions', 'action'];
  return botIndicators.some(
    indicator =>
      username.toLowerCase().includes(indicator)
  );
}

// Function to generate Markdown contributor list
function generateContributorMarkdown(contributors) {
  let markdown = '## Contributors\n\n';
  markdown += 'Thanks to all the contributors who help make Kilo Code better!\n\n';

  // Filter out bot users first
  const validContributors = contributors.filter(contributor => !isBotUser(contributor.login));

  // Create a grid of contributor avatars in rows of 5
  let contributorGrid = '<table>\n';

  for (let i = 0; i < validContributors.length; i++) {
    const contributor = validContributors[i];

    // Start a new row every 5 contributors
    if (i % 5 === 0) {
      if (i > 0) {
        contributorGrid += '\n  </tr>\n';
      }
      contributorGrid += '  <tr>\n';
    }

    const contributorCell = `    <td align="center">
      <a href="${contributor.html_url}">
        <img src="${contributor.avatar_url}?size=100" width="100" height="100" alt="${contributor.login}" style="border-radius: 50%;" />
        <br />
        <sub><b>${contributor.login}</b></sub>
      </a>
    </td>`;

    contributorGrid += contributorCell;
  }

  // Close the last row
  contributorGrid += '\n  </tr>\n</table>\n';

  markdown += contributorGrid;
  return markdown;
}

// Function to update the contributors section in the README
async function updateContributorsSection() {
  try {
    console.log('Fetching contributors from GitHub...');

    // Fetch contributors from GitHub API
    const contributors = await makeRequest(GITHUB_API_URL);

    if (!Array.isArray(contributors)) {
      throw new Error('Failed to fetch contributors data');
    }

    console.log(`Found ${contributors.length} contributors`);

    // Generate Markdown content
    const contributorMarkdown = generateContributorMarkdown(contributors);

    // Read the existing README
    let readmeContent = fs.readFileSync(README_FILE, 'utf8');

    // Find the contributors section markers or add at the end
    const contributorsStartMarker = '## Contributors';
    const contributorsEndMarker = '<!-- END CONTRIBUTORS SECTION -->';

    let newContent;

    if (readmeContent.includes(contributorsStartMarker)) {
      // Replace existing contributors section
      const startIndex = readmeContent.indexOf(contributorsStartMarker);
      const endIndex = readmeContent.indexOf(contributorsEndMarker);

      if (endIndex === -1) {
        // No end marker, replace from start to end of file
        newContent = readmeContent.substring(0, startIndex) + contributorMarkdown;
      } else {
        // Replace between markers
        const beforeContent = readmeContent.substring(0, startIndex);
        const afterContent = readmeContent.substring(endIndex + contributorsEndMarker.length);
        newContent = beforeContent + contributorMarkdown + '\n' + contributorsEndMarker + afterContent;
      }
    } else {
      // Add contributors section at the end
      newContent = readmeContent.trim() + '\n\n' + contributorMarkdown + '\n<!-- END CONTRIBUTORS SECTION -->\n';
    }

    // Write the updated content back to the README
    fs.writeFileSync(README_FILE, newContent);

    console.log('Contributors section updated successfully!');
  } catch (error) {
    console.error('Error updating contributors section:', error.message);
    process.exit(1);
  }
}

// Run the script
updateContributorsSection();