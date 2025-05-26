import * as jscodeshift from 'jscodeshift';
import { collectDependencies } from '../../utils/dependencies';
import { Scope } from '../../utils/Scope';

describe('dependencies', () => {
    describe('collectDependencies', () => {
        it('should identify external dependencies', () => {
            // Create a simple function that uses external variables
            const code = `
function calculateTotal(items) {
    return items.reduce((sum, item) => sum + (item.price * taxRate), 0);
}`;

            const ast = jscodeshift.withParser('babel')(code);
            const nodes = ast.find(jscodeshift.FunctionDeclaration).nodes();

            // Collect dependencies
            const deps = collectDependencies(nodes);

            // Should find taxRate as a dependency
            expect(deps.has('taxRate')).toBe(true);
            // Shouldn't include function parameters or built-ins
            expect(deps.has('items')).toBe(false);
            expect(deps.has('sum')).toBe(false);
            expect(deps.has('item')).toBe(false);
            expect(deps.has('reduce')).toBe(false);
        });

        it('should respect current scope', () => {
            // Create a scope with pre-defined variables
            const scope = new Scope();
            scope.declare('preDefinedVar');

            const code = `
function testFunction() {
    return preDefinedVar + undefinedVar;
}`;

            const ast = jscodeshift.withParser('babel')(code);
            const nodes = ast.find(jscodeshift.FunctionDeclaration).nodes();

            // Collect dependencies with the scope
            const deps = collectDependencies(nodes, new Set(), scope);

            // Should only find undefinedVar as a dependency (preDefinedVar is in scope)
            expect(deps.has('undefinedVar')).toBe(true);
            expect(deps.has('preDefinedVar')).toBe(false);
        });

        it('should handle nested scopes and variable declarations', () => {
            const code = `
function outerFunction() {
    const localVar = 1;
    
    function innerFunction() {
        const anotherLocal = 2;
        return localVar + anotherLocal + externalVar;
    }
    
    return innerFunction() + anotherExternalVar;
}`;

            const ast = jscodeshift.withParser('babel')(code);
            const nodes = ast.find(jscodeshift.FunctionDeclaration).nodes();

            // Collect dependencies
            const deps = collectDependencies(nodes);

            // Should find both external variables
            expect(deps.has('externalVar')).toBe(true);
            expect(deps.has('anotherExternalVar')).toBe(true);

            // Shouldn't include local variables
            expect(deps.has('localVar')).toBe(false);
            expect(deps.has('anotherLocal')).toBe(false);
            expect(deps.has('innerFunction')).toBe(false);
        });

        it('should handle object and array destructuring', () => {
            const code = `
function processData({ name, value }, [first, second]) {
    const { id } = config;
    const [count] = counts;
    return name + value + first + second + id + count + external;
}`;

            const ast = jscodeshift.withParser('babel')(code);
            const nodes = ast.find(jscodeshift.FunctionDeclaration).nodes();

            // Collect dependencies
            const deps = collectDependencies(nodes);

            // Should find external dependencies
            expect(deps.has('config')).toBe(true);
            expect(deps.has('counts')).toBe(true);
            expect(deps.has('external')).toBe(true);

            // Shouldn't include destructured variables
            expect(deps.has('name')).toBe(false);
            expect(deps.has('value')).toBe(false);
            expect(deps.has('first')).toBe(false);
            expect(deps.has('second')).toBe(false);
            expect(deps.has('id')).toBe(false);
            expect(deps.has('count')).toBe(false);
        });

        it('should handle member expressions', () => {
            const code = `
function getMessage() {
    return user.profile.name + window.location.href;
}`;

            const ast = jscodeshift.withParser('babel')(code);
            const nodes = ast.find(jscodeshift.FunctionDeclaration).nodes();

            // Collect dependencies
            const deps = collectDependencies(nodes);

            // Should find the root object of member expressions
            expect(deps.has('user')).toBe(true);
            // Should not include built-ins
            expect(deps.has('window')).toBe(false);
            // Should not include nested properties
            expect(deps.has('profile')).toBe(false);
            expect(deps.has('location')).toBe(false);
        });
    });
});