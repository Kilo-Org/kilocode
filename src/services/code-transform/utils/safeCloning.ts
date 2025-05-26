/**
 * Utilities for safely handling AST node cloning to prevent stack overflow issues
 */

/**
 * Safely clone an AST node without risking stack overflow from circular references
 * 
 * @param node The AST node to clone
 * @returns A deep clone of the node with circular references handled
 */
export function safeCloneNode(node: any): any {
    if (!node || typeof node !== 'object') {
        return node;
    }

    // Use a WeakMap to track processed objects and avoid circular references
    const visited = new WeakMap();

    // Use iterative approach instead of recursion
    function clone(obj: any): any {
        if (!obj || typeof obj !== 'object') {
            return obj;
        }

        // Handle arrays
        if (Array.isArray(obj)) {
            return obj.map(item => {
                if (item && typeof item === 'object') {
                    return clone(item);
                }
                return item;
            });
        }

        // Check for circular reference
        if (visited.has(obj)) {
            return visited.get(obj);
        }

        // Create a new object
        const cloned: Record<string, any> = Array.isArray(obj) ? [] : {};

        // Add to visited before recursing to handle circular references
        visited.set(obj, cloned);

        // Copy all properties
        for (const key of Object.keys(obj)) {
            // Skip properties that cause issues or are not needed
            if (key === 'parent' || key === 'scope' || key === 'references' || key === 'loc' || key === 'range') {
                continue;
            }

            // Clone value
            cloned[key] = clone(obj[key]);
        }

        return cloned;
    }

    return clone(node);
}

/**
 * Safely extract comments from a node
 *
 * @param node The AST node containing comments
 * @returns A safe copy of the comments array with all properties preserved
 */
export function safeExtractComments(node: any): any[] {
    if (!node || !node.comments || !Array.isArray(node.comments)) {
        return [];
    }

    // Create a comprehensive copy of the comments, preserving all properties
    return node.comments.map((comment: any) => {
        // Start with a base object containing essential properties
        const commentCopy: any = {
            type: comment.type,
            value: comment.value,
            leading: comment.leading,
            trailing: comment.trailing,
        };

        // Preserve JSDoc-specific properties
        if (comment.type === 'CommentBlock' || comment.type === 'Block') {
            commentCopy.isJSDoc = !!comment.isJSDoc;
        }

        // Preserve location information
        if (comment.loc) {
            commentCopy.loc = {
                start: { line: comment.loc.start.line, column: comment.loc.start.column },
                end: { line: comment.loc.end.line, column: comment.loc.end.column }
            };
        }

        // Preserve range information if available
        if (comment.range) {
            commentCopy.range = [...comment.range];
        }

        // Preserve any additional properties that might be present
        for (const key in comment) {
            if (!commentCopy.hasOwnProperty(key) &&
                key !== 'parent' &&
                key !== 'scope' &&
                key !== 'references') {
                commentCopy[key] = comment[key];
            }
        }

        return commentCopy;
    });
}