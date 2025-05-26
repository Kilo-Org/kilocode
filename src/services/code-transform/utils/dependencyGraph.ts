import { DependencyGraph } from './types';

/**
 * Implementation of a dependency graph for managing file dependencies
 */
export class FileDependencyGraph implements DependencyGraph {
    nodes = new Map<string, Set<string>>();

    addDependency(from: string, to: string): void {
        if (!this.nodes.has(from)) {
            this.nodes.set(from, new Set());
        }
        this.nodes.get(from)!.add(to);
    }

    hasCycle(): boolean {
        const visited = new Set<string>();
        const recursionStack = new Set<string>();

        const hasCycleUtil = (node: string): boolean => {
            visited.add(node);
            recursionStack.add(node);

            const dependencies = this.nodes.get(node) || new Set();
            for (const dep of dependencies) {
                if (!visited.has(dep)) {
                    if (hasCycleUtil(dep)) return true;
                } else if (recursionStack.has(dep)) {
                    return true;
                }
            }

            recursionStack.delete(node);
            return false;
        };

        for (const node of this.nodes.keys()) {
            if (!visited.has(node)) {
                if (hasCycleUtil(node)) return true;
            }
        }
        return false;
    }

    getProcessingOrder(): string[] {
        const visited = new Set<string>();
        const stack: string[] = [];

        const topologicalSort = (node: string): void => {
            visited.add(node);
            const dependencies = this.nodes.get(node) || new Set();

            for (const dep of dependencies) {
                if (!visited.has(dep)) {
                    topologicalSort(dep);
                }
            }
            stack.push(node);
        };

        for (const node of this.nodes.keys()) {
            if (!visited.has(node)) {
                topologicalSort(node);
            }
        }

        return stack.reverse();
    }
}