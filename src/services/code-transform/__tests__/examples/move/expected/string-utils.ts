/**
 * String utility functions moved from utils.ts
 */

export function toTitleCase(text: string): string {
    return text
        .split(' ')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
}