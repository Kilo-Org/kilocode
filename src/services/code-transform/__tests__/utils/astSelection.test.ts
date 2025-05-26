import * as jscodeshift from 'jscodeshift';
import { isNodeInRange, selectNodesInRange } from '../../utils/astSelection';

describe('astSelection', () => {
  describe('isNodeInRange', () => {
    it('should return false for nodes without location info', () => {
      expect(isNodeInRange({}, 1, 2)).toBe(false);
      expect(isNodeInRange(null, 1, 2)).toBe(false);
      expect(isNodeInRange({ type: 'FunctionDeclaration' }, 1, 2)).toBe(false);
    });

    it('should correctly identify nodes within range', () => {
      // Node starting at line 5 and ending at line 7
      const node = {
        loc: {
          start: { line: 5, column: 0 },
          end: { line: 7, column: 1 }
        }
      };

      // 1-based line numbers
      expect(isNodeInRange(node, 4, 8)).toBe(true); // Node is within range
      expect(isNodeInRange(node, 5, 7)).toBe(true); // Node exactly matches range
      expect(isNodeInRange(node, 6, 10)).toBe(false); // Node starts before range
      expect(isNodeInRange(node, 1, 6)).toBe(false); // Node ends after range
      expect(isNodeInRange(node, 8, 10)).toBe(false); // Node is before range
      expect(isNodeInRange(node, 1, 4)).toBe(false); // Node is after range
    });
  });

  describe('selectNodesInRange', () => {
    it('should select top-level nodes within the specified range', () => {
      // Create a simple AST
      const sourceCode = `
function test1() {
  return 1;
}

function test2() {
  return 2;
}

function test3() {
  return 3;
}
`;
      const ast = jscodeshift.withParser('babel')(sourceCode);

      // Select only test2 function (lines 6-8)
      const { nodesToMove, nodesToRemove } = selectNodesInRange(ast, 6, 8);

      // Should find one node
      expect(nodesToMove.length).toBe(1);
      expect(nodesToRemove.length).toBe(1);

      // The node should be the test2 function
      if (nodesToMove.length > 0) {
        expect(nodesToMove[0].type).toBe('FunctionDeclaration');
        expect(nodesToMove[0].id?.name).toBe('test2');
      }
    });

    it('should find nested functions when selecting parent nodes', () => {
      // Create a simple AST with nested nodes
      const sourceCode = `
function outer() {
  function inner() {
    return 1;
  }
  return inner();
}
`;
      const ast = jscodeshift.withParser('babel')(sourceCode);

      // Select the outer function
      const { nodesToMove, nestedFunctions } = selectNodesInRange(ast, 2, 7);

      // Should find 1 top-level node (outer function)
      expect(nodesToMove.length).toBe(1);

      // Should also find the nested inner function
      expect(nestedFunctions.length).toBeGreaterThan(0);

      // Find the inner function in the results
      const innerFunction = nestedFunctions.find(fn => fn.id && fn.id.name === 'inner');
      expect(innerFunction).toBeDefined();
      expect(innerFunction?.id.name).toBe('inner');
    });
  });
});