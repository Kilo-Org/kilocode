import { ToolArgs } from "./types"

export function getReadMediaDescription(args: ToolArgs): string {
	return `## read_media

Description: Reads media file content (images, audio, video) and returns it in a format suitable for multimodal recognition. This tool should be used when the content of the file needs to be identified or analyzed, such as recognizing objects in an image.

**When to Use:**
- Use \`read_media\` for media files (e.g., PNG, JPEG, MP4) that you want the AI to "see" or "hear".
- For reading plain text files or getting file content as text, use the \`read_file\` tool instead.

<read_media>
<path>The path to the media file</path>
</read_media>

- path: The path to the file to be read. It can be a relative path from the current working directory or an absolute path.

Example:

<read_media>
<path>assets/image.png</path>
</read_media>
`
}
