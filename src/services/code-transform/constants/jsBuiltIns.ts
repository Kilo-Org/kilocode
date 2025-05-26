/**
 * JavaScript built-in identifiers and keywords
 * Used to avoid false positives when detecting dependencies
 */
export const jsBuiltIns = new Set([
    // Global objects
    'console', 'document', 'window', 'process', 'require', 'module', 'exports',

    // JavaScript built-in objects
    'Array', 'Object', 'String', 'Number', 'Boolean', 'Date', 'Error',
    'Math', 'JSON', 'Promise', 'Map', 'Set', 'WeakMap', 'WeakSet', 'RegExp',
    'Symbol', 'BigInt', 'Proxy', 'Reflect', 'Intl', 'globalThis',

    // JavaScript keywords
    'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'break',
    'continue', 'return', 'function', 'class', 'const', 'let', 'var',
    'this', 'super', 'new', 'try', 'catch', 'finally', 'throw',
    'typeof', 'instanceof', 'in', 'of', 'void', 'null', 'undefined',
    'true', 'false', 'export', 'import', 'default', 'extends', 'implements',
    'async', 'await', 'yield', 'delete', 'with',

    // TypeScript specific
    'type', 'interface', 'namespace', 'enum', 'as', 'declare', 'readonly',

    // Common DOM APIs
    'addEventListener', 'removeEventListener', 'setTimeout', 'clearTimeout',
    'setInterval', 'clearInterval', 'requestAnimationFrame', 'cancelAnimationFrame',
    'fetch', 'XMLHttpRequest'
]);