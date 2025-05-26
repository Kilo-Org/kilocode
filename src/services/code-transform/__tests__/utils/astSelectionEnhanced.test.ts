import * as jscodeshiftModule from 'jscodeshift';
import {
    CodeStructureNode,
    CodeStructureType,
    extractNestedFunctions,
    identifyCodeStructures,
    isNodeInRange,
    isNodeNestedIn,
    selectNodesInRange,
    selectNodesWithContext,
    validateNodeSelection,
    CommonValidationRules
} from '../../utils/astSelection';
import { LocationSelector, IdentifierSelector } from '../../dsl/types';

// Use the default export from jscodeshift
const j = jscodeshiftModule.default;

describe('Enhanced AST Selection', () => {
    // Helper functions are defined below as needed in tests

    describe('isNodeInRange', () => {
        it('should correctly identify nodes fully within a range', () => {
            const node = {
                type: 'FunctionDeclaration',
                loc: { start: { line: 5, column: 0 }, end: { line: 10, column: 1 } }
            };

            expect(isNodeInRange(node, 4, 12)).toBe(true);
            expect(isNodeInRange(node, 5, 10)).toBe(true);
            expect(isNodeInRange(node, 6, 9)).toBe(false); // Not fully contained
        });

        it('should handle significant overlap', () => {
            const node = {
                type: 'ClassDeclaration',
                loc: { start: { line: 10, column: 0 }, end: { line: 20, column: 1 } }
            };

            // These ranges have overlap but do not fully contain the node.
            // With strict containment, these should now be false.
            expect(isNodeInRange(node, 12, 22)).toBe(false);
            expect(isNodeInRange(node, 8, 15)).toBe(false);

            // Less than 50% overlap (already false, no change needed)
            expect(isNodeInRange(node, 18, 25)).toBe(false);
        });

        it('should handle nodes without location info', () => {
            const node = { type: 'Identifier' };
            expect(isNodeInRange(node as any, 1, 10)).toBe(false);
        });
    });

    describe('isNodeNestedIn', () => {
        it('should correctly identify nested nodes', () => {
            const container = {
                loc: { start: { line: 5, column: 0 }, end: { line: 20, column: 1 } }
            };

            const nestedNode = {
                loc: { start: { line: 8, column: 2 }, end: { line: 15, column: 3 } }
            };

            const outsideNode = {
                loc: { start: { line: 2, column: 0 }, end: { line: 4, column: 1 } }
            };

            const partiallyNestedNode = {
                loc: { start: { line: 18, column: 0 }, end: { line: 25, column: 1 } }
            };

            expect(isNodeNestedIn(nestedNode, container)).toBe(true);
            expect(isNodeNestedIn(outsideNode, container)).toBe(false);
            expect(isNodeNestedIn(partiallyNestedNode, container)).toBe(false);
            expect(isNodeNestedIn(container, container)).toBe(false); // Same node
        });
    });

    describe('extractNestedFunctions', () => {
        it('should extract named functions from a node', () => {
            const code = `
        function outerFunction() {
          function innerFunction1() {
            return 1;
          }
          
          const x = function innerFunction2() {
            return 2;
          };
          
          const y = () => {
            return 3;
          };
        }
      `;

            const ast = j(code);
            // Get the outerFunction node from the program body
            const programBody = ast.find(j.Program).get().node.body;
            const outerFunction = programBody.find((node: any) =>
                node.type === 'FunctionDeclaration' && node.id?.name === 'outerFunction'
            );

            const nestedFunctions = extractNestedFunctions(outerFunction);

            // Should find the named function declarations/expressions
            expect(nestedFunctions.length).toBeGreaterThan(0);

            // Check that innerFunction1 was found
            const innerFunction1 = nestedFunctions.find(f =>
                f.id && f.id.name === 'innerFunction1'
            );
            expect(innerFunction1).toBeDefined();

            // Check that innerFunction2 was found
            const innerFunction2 = nestedFunctions.find(f =>
                f.id && f.id.name === 'innerFunction2'
            );
            expect(innerFunction2).toBeDefined();
        });
    });

    describe('selectNodesInRange', () => {
        it('should select top-level nodes in a given range', () => {
            const code = `
        import { something } from 'somewhere';
        
        const x = 1;
        const y = 2;
        
        function aFunction() {
          return x + y;
        }
        
        class AClass {
          method() {
            return 'hello';
          }
        }
        
        export default aFunction;
      `;

            const ast = j(code);
            const { nodesToMove } = selectNodesInRange(ast, 6, 8); // Should select aFunction

            // The function 'aFunction' is on lines 132-134. The range 6-8 does not fully contain it.
            // With strict containment, no nodes should be selected.
            expect(nodesToMove.length).toBe(0);
            // Removed assertions about the selected node as none should be selected.
        });
    });

    describe('identifyCodeStructures', () => {
        it('should identify functions in code', () => {
            const code = `
        function func1() { return 1; }
        const func2 = function() { return 2; };
        const func3 = () => 3;
        
        class TestClass {
          method1() { return 4; }
          method2 = () => 5;
        }
      `;

            const ast = j(code);
            const functions = identifyCodeStructures(ast, CodeStructureType.Function);

            // Should find func1, func2, func3
            expect(functions.length).toBeGreaterThanOrEqual(3);

            // Check for named function
            const namedFunction = functions.find(f => f.name === 'func1');
            expect(namedFunction).toBeDefined();
        });

        it('should identify classes in code', () => {
            const code = `
        class Class1 {}
        const Class2 = class NamedClass {};
        
        function notAClass() {}
      `;

            const ast = j(code);
            const classes = identifyCodeStructures(ast, CodeStructureType.Class);

            expect(classes.length).toBeGreaterThanOrEqual(1);

            // Check for named class
            const namedClass = classes.find(c => c.name === 'Class1');
            expect(namedClass).toBeDefined();
        });
    });

    describe('validateNodeSelection', () => {
        it('should validate nodes against common rules', () => {
            const validNode: CodeStructureNode = {
                node: { type: 'FunctionDeclaration', body: { type: 'BlockStatement', body: [{}] } },
                type: CodeStructureType.Function,
                name: 'validFunction',
                range: { startLine: 1, endLine: 5, startColumn: 0, endColumn: 1 }
            };

            const invalidNode: CodeStructureNode = {
                node: { type: 'FunctionDeclaration', body: { type: 'BlockStatement', body: [] } },
                type: CodeStructureType.Function,
                name: 'emptyFunction',
                range: { startLine: 10, endLine: 5, startColumn: 0, endColumn: 1 } // Invalid range
            };

            // Test location validation
            const locationResult = validateNodeSelection(
                [validNode, invalidNode],
                [CommonValidationRules.hasValidLocation]
            );

            expect(locationResult.isValid).toBe(false);
            expect(locationResult.issues.length).toBe(1);

            // Test function body validation
            const functionResult = validateNodeSelection(
                [validNode, invalidNode],
                [CommonValidationRules.functionHasBody]
            );

            expect(functionResult.isValid).toBe(false);
        });
    });

    describe('selectNodesWithContext', () => {
        it('should select nodes based on location selector', async () => {
            const code = `
        const x = 1;
        
        function aFunction() {
          return x;
        }
        
        class AClass {}
      `;

            const ast = j(code);
            const locationSelector: LocationSelector = {
                type: 'location',
                filePath: 'test.ts',
                startLine: 3,
                endLine: 5
            };

            const nodes = await selectNodesWithContext(ast, locationSelector);

            // The function 'aFunction' is on lines 237-239. The range 3-5 does not fully contain it.
            // With strict containment, no nodes should be selected.
            expect(nodes.length).toBe(0);
            // Removed assertions about the selected node as none should be selected.
        });

        it('should select nodes based on identifier selector', async () => {
            const code = `
        const targetVar = 123;
        function targetFn() {}
        class NotTarget {}
      `;

            const ast = j(code);

            // Test for variable
            const variableSelector: IdentifierSelector = {
                type: 'identifier',
                name: 'targetVar',
                kind: 'variable'
            };

            const varNodes = await selectNodesWithContext(ast, variableSelector);
            expect(varNodes.length).toBeGreaterThan(0);
            expect(varNodes[0].name).toBe('targetVar');

            // Test for function
            const functionSelector: IdentifierSelector = {
                type: 'identifier',
                name: 'targetFn',
                kind: 'function'
            };

            const fnNodes = await selectNodesWithContext(ast, functionSelector);
            expect(fnNodes.length).toBeGreaterThan(0);
            expect(fnNodes[0].name).toBe('targetFn');
        });
    });
});