"""
This script updates a specific version's release notes section in CHANGELOG.md with new content
or reformats existing content.

The script:
1. Takes a version number, changelog path, and optionally new content as input from environment variables
2. Finds the section in the changelog for the specified version
3. Either:
   a) Replaces the content with new content if provided, or
   b) Reformats existing content by:
      - Removing the first two lines of the changeset format
      - Ensuring version numbers are wrapped in square brackets
4. Writes the updated changelog back to the file

Environment Variables:
    CHANGELOG_PATH: Path to the changelog file (defaults to 'CHANGELOG.md')
    VERSION: The version number to update/format
    PREV_VERSION: The previous version number (used to locate section boundaries)
    NEW_CONTENT: Optional new content to insert for this version
"""

#!/usr/bin/env python3

import os

CHANGELOG_PATH = os.environ.get("CHANGELOG_PATH", "CHANGELOG.md")
VERSION = os.environ['VERSION']
PREV_VERSION = os.environ.get("PREV_VERSION", "")
NEW_CONTENT = os.environ.get("NEW_CONTENT", "")

def overwrite_changelog_section(changelog_text: str, new_content: str):
    # Find the section for the specified version
    # Try multiple patterns to find the version header
    version_patterns = [
        f"## {VERSION}\n",
        f"## [{VERSION}]\n",
        f"## [v{VERSION}]\n"
    ]

    # Try multiple patterns for previous version
    prev_version_patterns = [
        f"## {PREV_VERSION}\n" if PREV_VERSION else "",
        f"## [{PREV_VERSION}]\n" if PREV_VERSION else "",
        f"## [v{PREV_VERSION}]\n" if PREV_VERSION else ""
    ]

    print(f"latest version: {VERSION}")
    print(f"prev_version: {PREV_VERSION}")
    print(f"Looking for version patterns: {version_patterns}")
    print(f"Looking for prev version patterns: {prev_version_patterns}")

    # Find which pattern matches for current version
    notes_start_index = -1
    matched_pattern = None
    for pattern in version_patterns:
        index = changelog_text.find(pattern)
        if index != -1:
            notes_start_index = index + len(pattern)
            matched_pattern = pattern
            print(f"Found current version with pattern: '{pattern}' at index {index}")
            break

    if notes_start_index == -1:
        print(f"ERROR: Could not find any version pattern for {VERSION}")
        print("First 500 chars of changelog:")
        print(changelog_text[:500])
        return changelog_text

    # Find end boundary using previous version patterns
    notes_end_index = len(changelog_text)
    if PREV_VERSION:
        for pattern in prev_version_patterns:
            if pattern:
                index = changelog_text.find(pattern, notes_start_index)
                if index != -1:
                    notes_end_index = index
                    print(f"Found previous version boundary with pattern: '{pattern}' at index {index}")
                    break

    print(f"Content section from {notes_start_index} to {notes_end_index}")
    section_content = changelog_text[notes_start_index:notes_end_index]
    print(f"Section content (first 200 chars): {section_content[:200]}")

    if new_content:
        updated_changelog = changelog_text[:notes_start_index] + f"{new_content}\n" + changelog_text[notes_end_index:]
        # Replace any existing version format with the desired [vX.X.X] format
        for pattern in version_patterns:
            pattern_without_newline = pattern.rstrip('\n')
            updated_changelog = updated_changelog.replace(pattern_without_newline, f"## [v{VERSION}]")
        return updated_changelog
    else:
        changeset_lines = changelog_text[notes_start_index:notes_end_index].split("\n")
        # Remove the first two lines from the regular changeset format, ex: \n### Patch Changes
        parsed_lines = "\n".join(changeset_lines[2:])
        updated_changelog = changelog_text[:notes_start_index] + parsed_lines + changelog_text[notes_end_index:]
        # Replace any existing version format with the desired [vX.X.X] format
        for pattern in version_patterns:
            pattern_without_newline = pattern.rstrip('\n')
            updated_changelog = updated_changelog.replace(pattern_without_newline, f"## [v{VERSION}]")
        return updated_changelog

with open(CHANGELOG_PATH, 'r') as f:
    changelog_content = f.read()

new_changelog = overwrite_changelog_section(changelog_content, NEW_CONTENT)
print("----------------------------------------------------------------------------------")
print(new_changelog)
print("----------------------------------------------------------------------------------")
# Write back to CHANGELOG.md
with open(CHANGELOG_PATH, 'w') as f:
    f.write(new_changelog)

print(f"{CHANGELOG_PATH} updated successfully!")
