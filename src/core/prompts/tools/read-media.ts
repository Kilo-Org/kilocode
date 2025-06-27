import { ToolArgs } from "./types"

export function getReadMediaDescription(args: ToolArgs): string {
	return `## read_media

Description: Reads media file content (images, audio, video) and returns metadata and/or content.

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
