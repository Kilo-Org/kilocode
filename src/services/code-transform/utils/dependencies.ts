import { jsBuiltIns } from '../constants/jsBuiltIns';
import { Scope } from './Scope';

// Common methods on objects and arrays - don't treat these as dependencies
const COMMON_METHODS = new Set([
    'length', 'map', 'filter', 'reduce', 'forEach', 'find',
    'some', 'every', 'includes', 'indexOf', 'lastIndexOf',
    'slice', 'splice', 'concat', 'join', 'push', 'pop',
    'shift', 'unshift', 'toString', 'valueOf'
]);

/**
 * Collect dependencies from a set of AST nodes
 * Identifies variables used in the nodes that aren't defined within the nodes themselves
 *
 * @param nodes Array of AST nodes to analyze
 * @param definedSymbols Set of symbols defined within the nodes (to exclude from dependencies)
 * @param scope Current lexical scope (to exclude variables already in scope)
 * @returns Set of dependency names that need to be imported
 */
export function collectDependencies(
    nodes: any[],
    definedSymbols: Set<string> = new Set(),
    scope: Scope = new Scope()
): Set<string> {
    const dependencies = new Set<string>();
    const localVariables = new Set<string>();

    // First pass: collect all declared variables across all nodes
    // This helps with handling forward references
    for (const node of nodes) {
        collectDeclaredVariables(node, localVariables);
    }

    // Second pass: process nodes to find dependencies
    for (const node of nodes) {
        processNode(node, scope, localVariables, dependencies, definedSymbols);
    }

    // Third pass: analyze function bodies for calls to helper functions
    // This helps identify dependencies that might be missed in the first passes
    for (const node of nodes) {
        if (node.type === 'FunctionDeclaration' ||
            node.type === 'FunctionExpression' ||
            node.type === 'ArrowFunctionExpression' ||
            node.type === 'ClassDeclaration' ||
            node.type === 'ClassMethod' ||
            node.type === 'MethodDefinition') {

            findFunctionCalls(node, dependencies, localVariables, definedSymbols, scope);
        }
    }

    return dependencies;
}

/**
 * Find function calls within a node that might be dependencies
 * This helps catch helper functions that are called but might be missed
 * by the regular identifier processing
 */
function findFunctionCalls(
    node: any,
    dependencies: Set<string>,
    localVars: Set<string>,
    definedSymbols: Set<string>,
    scope: Scope
): void {
    if (!node || typeof node !== 'object') return;

    // Use a stack to avoid recursion
    const stack: any[] = [node];
    const visited = new WeakSet();

    while (stack.length > 0) {
        const currentNode = stack.pop();

        if (!currentNode || typeof currentNode !== 'object' || visited.has(currentNode)) {
            continue;
        }

        visited.add(currentNode);

        // Check for function calls
        if (currentNode.type === 'CallExpression') {
            if (currentNode.callee.type === 'Identifier') {
                const name = currentNode.callee.name;

                // If the function name is not a local variable, not in scope,
                // not a defined symbol, and not a built-in, it's a dependency
                if (!localVars.has(name) &&
                    !scope.has(name) &&
                    !definedSymbols.has(name) &&
                    !jsBuiltIns.has(name)) {
                    dependencies.add(name);
                }
            }
        }

        // Process all child properties
        for (const key in currentNode) {
            if (currentNode.hasOwnProperty(key) && key !== 'loc' && key !== 'range' && key !== 'comments') {
                const child = currentNode[key];

                if (Array.isArray(child)) {
                    for (let i = child.length - 1; i >= 0; i--) {
                        if (child[i] && typeof child[i] === 'object') {
                            stack.push(child[i]);
                        }
                    }
                } else if (child && typeof child === 'object') {
                    stack.push(child);
                }
            }
        }
    }
}

/**
 * Pre-process a node to collect all variable declarations
 * This helps handle forward references properly
 */
function collectDeclaredVariables(node: any, localVars: Set<string>): void {
    if (!node || typeof node !== 'object') return;

    // Use a stack to avoid recursion
    const stack: any[] = [node];
    const visited = new WeakSet();

    while (stack.length > 0) {
        const currentNode = stack.pop();

        if (!currentNode || typeof currentNode !== 'object' || visited.has(currentNode)) {
            continue;
        }

        visited.add(currentNode);

        // Check node type and collect declarations
        if (currentNode.type === 'FunctionDeclaration' || currentNode.type === 'FunctionExpression') {
            if (currentNode.id && currentNode.id.name) {
                localVars.add(currentNode.id.name);
            }

            // Add parameters to local variables
            if (currentNode.params) {
                for (const param of currentNode.params) {
                    extractNamesFromPattern(param, localVars);
                }
            }
        } else if (currentNode.type === 'VariableDeclarator') {
            extractNamesFromPattern(currentNode.id, localVars);
        } else if (currentNode.type === 'ClassDeclaration') {
            if (currentNode.id && currentNode.id.name) {
                localVars.add(currentNode.id.name);
            }
        }

        // Process all child properties
        for (const key in currentNode) {
            if (currentNode.hasOwnProperty(key) && key !== 'loc' && key !== 'range' && key !== 'comments') {
                const child = currentNode[key];

                if (Array.isArray(child)) {
                    for (let i = child.length - 1; i >= 0; i--) {
                        if (child[i] && typeof child[i] === 'object') {
                            stack.push(child[i]);
                        }
                    }
                } else if (child && typeof child === 'object') {
                    stack.push(child);
                }
            }
        }
    }
}

/**
 * Extract variable names from a pattern (for destructuring)
 */
function extractNamesFromPattern(pattern: any, localVars: Set<string>): void {
    if (!pattern) return;

    if (pattern.type === 'Identifier') {
        localVars.add(pattern.name);
    } else if (pattern.type === 'ObjectPattern') {
        for (const prop of pattern.properties || []) {
            // Handle nested patterns in object destructuring
            if (prop.value) {
                extractNamesFromPattern(prop.value, localVars);
            }
        }
    } else if (pattern.type === 'ArrayPattern') {
        for (const element of pattern.elements || []) {
            if (element) {
                extractNamesFromPattern(element, localVars);
            }
        }
    } else if (pattern.type === 'AssignmentPattern') {
        extractNamesFromPattern(pattern.left, localVars);
    }
}

/**
 * Process a node and collect dependencies
 * Uses an iterative approach with a stack to avoid call stack issues
 */
function processNode(
    node: any,
    scope: Scope,
    localVars: Set<string>,
    dependencies: Set<string>,
    definedSymbols: Set<string>
): void {
    if (!node || typeof node !== 'object') return;

    // Use an explicit stack to avoid recursive calls
    const stack: {
        node: any;
        scope: Scope;
    }[] = [{ node, scope }];

    // Keep track of visited nodes to prevent infinite loops from circular dependencies
    const visited = new WeakSet();

    while (stack.length > 0) {
        const { node: currentNode, scope: currentScope } = stack.pop()!;

        // Skip if null or already visited to prevent cycles
        if (!currentNode || typeof currentNode !== 'object' || visited.has(currentNode)) {
            continue;
        }

        // Mark as visited
        visited.add(currentNode);

        // Handle specific node types
        switch (currentNode.type) {
            case 'FunctionDeclaration':
            case 'FunctionExpression':
            case 'ArrowFunctionExpression':
                // Add function name to local variables
                if (currentNode.id && currentNode.id.name) {
                    localVars.add(currentNode.id.name);
                }

                // Create a new scope for this function
                const functionScope = currentScope.child();

                // Add parameters to function scope
                if (currentNode.params) {
                    for (const param of currentNode.params) {
                        addParamToScope(param, functionScope, localVars);
                    }
                }

                // Add body to stack with the new scope
                if (currentNode.body) {
                    stack.push({ node: currentNode.body, scope: functionScope });
                }
                continue;

            case 'VariableDeclaration':
                // Add all declared variables to scope
                for (const decl of currentNode.declarations) {
                    addDeclToScope(decl, currentScope, localVars);

                    // Process initializer
                    if (decl.init) {
                        stack.push({ node: decl.init, scope: currentScope });
                    }
                }
                continue;

            case 'ClassDeclaration':
                if (currentNode.id && currentNode.id.name) {
                    localVars.add(currentNode.id.name);
                }
                break;

            case 'Identifier':
                const name = currentNode.name;

                // Check if identifier is part of a parent node that would make it not a dependency
                const parent = currentNode.parent;

                // Skip if this is a property name in a member expression
                if (parent &&
                    parent.type === 'MemberExpression' &&
                    parent.property === currentNode &&
                    !parent.computed) {
                    continue;
                }

                // Skip if this is a property key in an object
                if (parent &&
                    parent.type === 'Property' &&
                    parent.key === currentNode &&
                    !parent.computed) {
                    continue;
                }

                // Skip if this is a declaration (not a usage)
                if ((parent && parent.type === 'VariableDeclarator' && parent.id === currentNode) ||
                    (parent && parent.type === 'FunctionDeclaration' && parent.id === currentNode) ||
                    (parent && parent.type === 'ClassDeclaration' && parent.id === currentNode)) {
                    continue;
                }

                // If not in scope, not a defined symbol, not a local variable, and not a built-in,
                // then it's a dependency
                if (!currentScope.has(name) &&
                    !definedSymbols.has(name) &&
                    !localVars.has(name) &&
                    !jsBuiltIns.has(name)) {
                    dependencies.add(name);
                }
                continue;

            case 'MemberExpression':
                // Process the object part (e.g., 'object' in object.property)
                stack.push({ node: currentNode.object, scope: currentScope });

                // Process the property part if it's computed (e.g., object[expr])
                if (currentNode.computed && currentNode.property) {
                    stack.push({ node: currentNode.property, scope: currentScope });
                }

                // Special handling for methods we want to ignore
                if (currentNode.object.type === 'Identifier' &&
                    currentNode.property.type === 'Identifier' &&
                    !currentNode.computed) {

                    const objectName = currentNode.object.name;
                    const propertyName = currentNode.property.name;

                    // Remove the dependency if it's a common method
                    if (COMMON_METHODS.has(propertyName)) {
                        dependencies.delete(objectName);
                    }
                }
                continue;
        }

        // Add all properties to the stack
        for (const key in currentNode) {
            if (currentNode.hasOwnProperty(key) && key !== 'loc' && key !== 'range' && key !== 'comments') {
                const child = currentNode[key];

                if (Array.isArray(child)) {
                    for (const item of child) {
                        if (item && typeof item === 'object') {
                            stack.push({ node: item, scope: currentScope });
                        }
                    }
                } else if (child && typeof child === 'object') {
                    stack.push({ node: child, scope: currentScope });
                }
            }
        }
    }
}

// The processFunctionNode function has been integrated into the iterative processNode
// implementation above and is no longer needed as a separate function

// The processVariableDeclaration function has been integrated into the iterative processNode
// implementation above and is no longer needed as a separate function

// The processIdentifier function has been integrated into the iterative processNode
// implementation above and is no longer needed as a separate function

// The processMemberExpression function has been integrated into the iterative processNode
// implementation above and is no longer needed as a separate function

/**
 * Helper function to add parameter to scope
 */
function addParamToScope(param: any, scope: Scope, localVars: Set<string>): void {
    if (!param) return;

    if (param.type === 'Identifier') {
        scope.declare(param.name);
        localVars.add(param.name);
    } else if (param.type === 'AssignmentPattern' && param.left.type === 'Identifier') {
        scope.declare(param.left.name);
        localVars.add(param.left.name);
    } else if (param.type === 'ObjectPattern') {
        // Handle object destructuring
        for (const prop of param.properties || []) {
            if (prop.value && prop.value.type === 'Identifier') {
                scope.declare(prop.value.name);
                localVars.add(prop.value.name);
            }
        }
    } else if (param.type === 'ArrayPattern') {
        // Handle array destructuring
        for (const element of param.elements || []) {
            if (element && element.type === 'Identifier') {
                scope.declare(element.name);
                localVars.add(element.name);
            }
        }
    }
}

/**
 * Helper function to add variable declaration to scope
 */
function addDeclToScope(decl: any, scope: Scope, localVars: Set<string>): void {
    if (!decl || !decl.id) return;

    if (decl.id.type === 'Identifier') {
        scope.declare(decl.id.name);
        localVars.add(decl.id.name);
    } else if (decl.id.type === 'ObjectPattern') {
        // Handle object destructuring
        for (const prop of decl.id.properties || []) {
            if (prop.value && prop.value.type === 'Identifier') {
                scope.declare(prop.value.name);
                localVars.add(prop.value.name);
            }
        }
    } else if (decl.id.type === 'ArrayPattern') {
        // Handle array destructuring
        for (const element of decl.id.elements || []) {
            if (element && element.type === 'Identifier') {
                scope.declare(element.name);
                localVars.add(element.name);
            }
        }
    }
}