/**
 * A class to manage lexical scope for variable declarations
 * Used for tracking which variables are in scope when analyzing dependencies
 */
export class Scope {
    private variables: Set<string>;
    private parent: Scope | null;

    /**
     * Create a new scope
     * @param parent Optional parent scope to inherit from
     */
    constructor(parent: Scope | null = null) {
        this.variables = new Set<string>();
        this.parent = parent;
    }

    /**
     * Declare a variable in the current scope
     * @param name The variable name to add to the scope
     */
    declare(name: string): void {
        this.variables.add(name);
    }

    /**
     * Check if a variable exists in the current scope or any parent scope
     * @param name The variable name to check
     * @returns True if the variable is in scope
     */
    has(name: string): boolean {
        if (this.variables.has(name)) {
            return true;
        }

        if (this.parent) {
            return this.parent.has(name);
        }

        return false;
    }

    /**
     * Create a child scope that inherits from this scope
     * @returns A new scope with this scope as its parent
     */
    child(): Scope {
        return new Scope(this);
    }

    /**
     * Get all variables declared in this scope (not parent scopes)
     * @returns Set of variable names
     */
    getLocalVariables(): Set<string> {
        return new Set(this.variables);
    }

    /**
     * Get all variables declared in this scope and all parent scopes
     * @returns Set of variable names
     */
    getAllVariables(): Set<string> {
        const allVars = new Set(this.variables);

        if (this.parent) {
            const parentVars = this.parent.getAllVariables();
            for (const v of parentVars) {
                allVars.add(v);
            }
        }

        return allVars;
    }
}