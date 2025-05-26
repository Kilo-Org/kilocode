import { toTitleCase } from "./string-utils";
/**
 * Utility functions for text manipulation
 */

export function formatText(text: string): string {
    return toTitleCase(text);
}

export function pluralize(text: string, count: number): string {
    if (count === 1) {
        return text;
    }
    return `${text}s`;
}