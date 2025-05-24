/**
 * This file demonstrates how to use jscodeshift to perform code refactoring operations
 * like moving code between files.
 * 
 * To run this example:
 * 1. Install jscodeshift: npm install --save jscodeshift
 * 2. Install types: npm install --save-dev @types/jscodeshift
 * 3. Run with: npx tsx src/examples/jscodeshift-example.ts
 */

import * as jscodeshift from 'jscodeshift';
import * as fs from 'fs/promises';
import * as path from 'path';

// Example source code
const sourceCode = `
// Source file with multiple declarations
import { something } from './somewhere';

// A function to move
function calculateTotal(items: number[]): number {
  let total = 0;
  for (const item of items) {
    total += item;
  }
  return total;
}

// Another function that will stay
function formatCurrency(amount: number): string {
  return \`$\${amount.toFixed(2)}\`;
}

// A class to move
class Product {
  id: string;
  name: string;
  price: number;
  
  constructor(id: string, name: string, price: number) {
    this.id = id;
    this.name = name;
    this.price = price;
  }
  
  getFormattedPrice(): string {
    return formatCurrency(this.price);
  }
}

// This will stay
const TAX_RATE = 0.07;
`;

// Target file might already have some content
const targetCode = `
// Target file with existing code
import { otherThing } from './elsewhere';

// Existing utility function
function generateId(): string {
  return Math.random().toString(36).substring(2, 9);
}
`;

/**
 * Move specific nodes from source to target
 * @param sourceCode Source file content
 * @param targetCode Target file content
 * @param nodesToMove Array of node types to move (e.g., ['function calculateTotal', 'class Product'])
 * @returns Object with modified source and target code
 */
function moveCodeBetweenFiles(
    sourceCode: string,
    targetCode: string,
    nodesToMove: string[]
): { modifiedSource: string; modifiedTarget: string } {
    // Parse the source code
    const sourceAst = jscodeshift.withParser('tsx')(sourceCode);
    const targetAst = jscodeshift.withParser('tsx')(targetCode);

    // Find nodes to move
    const nodesToRemove: jscodeshift.ASTPath[] = [];
    const extractedNodes: jscodeshift.ASTNode[] = [];

    // Helper to check if a node matches any of the specified patterns
    const shouldMoveNode = (node: any, _path: jscodeshift.ASTPath): boolean => {
        if (!node) return false;

        // For function declarations
        if (node.type === 'FunctionDeclaration' && node.id && node.id.name) {
            return nodesToMove.some(pattern =>
                pattern === `function ${node.id.name}`
            );
        }

        // For class declarations
        if (node.type === 'ClassDeclaration' && node.id && node.id.name) {
            return nodesToMove.some(pattern =>
                pattern === `class ${node.id.name}`
            );
        }

        return false;
    };

    // Find nodes to move in the source AST
    sourceAst.find(jscodeshift.Node).forEach((path: any) => {
        const node = path.node;

        // Only consider top-level nodes
        if (path.parent && path.parent.node.type === 'Program' && shouldMoveNode(node, path)) {
            // Add export to the node if it doesn't have one
            const exportedNode = jscodeshift.exportNamedDeclaration(node);
            extractedNodes.push(exportedNode);
            nodesToRemove.push(path);
        }
    });

    // Remove nodes from source
    nodesToRemove.forEach(path => {
        path.prune();
    });

    // Add nodes to target
    extractedNodes.forEach(node => {
        targetAst.find(jscodeshift.Program).get().node.body.push(node);
    });

    // Generate the modified code
    return {
        modifiedSource: sourceAst.toSource(),
        modifiedTarget: targetAst.toSource()
    };
}

// Example usage
async function runExample() {
    console.log('Original source code:');
    console.log('-------------------');
    console.log(sourceCode);
    console.log('\nOriginal target code:');
    console.log('-------------------');
    console.log(targetCode);

    // Move specific nodes
    const result = moveCodeBetweenFiles(
        sourceCode,
        targetCode,
        ['function calculateTotal', 'class Product']
    );

    console.log('\nModified source code:');
    console.log('-------------------');
    console.log(result.modifiedSource);
    console.log('\nModified target code:');
    console.log('-------------------');
    console.log(result.modifiedTarget);

    // Create example directory if it doesn't exist
    const exampleDir = path.join(__dirname, 'output');
    await fs.mkdir(exampleDir, { recursive: true });

    // Write the results to files
    await fs.writeFile(path.join(exampleDir, 'source.ts'), result.modifiedSource);
    await fs.writeFile(path.join(exampleDir, 'target.ts'), result.modifiedTarget);

    console.log('\nFiles written to:');
    console.log(`- ${path.join(exampleDir, 'source.ts')}`);
    console.log(`- ${path.join(exampleDir, 'target.ts')}`);
}

// Run the example
runExample().catch(console.error);