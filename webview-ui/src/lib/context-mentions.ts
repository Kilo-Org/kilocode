/**
 * Regular expression to match mentions in text.
 * Matches patterns like @mention or #tag.
 */
export const mentionRegex = /(@\w+|\#\w+)/g;

/**
 * Global regular expression to match mentions in text.
 * Matches patterns like @mention or #tag across the entire string.
 */
export const mentionRegexGlobal = /(@\w+|\#\w+)/g;

/**
 * Function to unescape spaces in a string.
 * @param str - The input string with escaped spaces.
 * @returns The string with unescaped spaces.
 */
export function unescapeSpaces(str: string): string {
  return str.replace(/\\ /g, ' ');
}