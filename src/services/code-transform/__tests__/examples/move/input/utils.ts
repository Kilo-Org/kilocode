/**
 * Utility functions for text manipulation
 */

export function formatText(text: string): string {
    return toTitleCase(text);
}

function toTitleCase(text: string): string {
    return text
        .split(' ')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
}

export function pluralize(text: string, count: number): string {
    if (count === 1) {
        return text;
    }
    return `${text}s`;
}