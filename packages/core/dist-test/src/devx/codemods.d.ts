export interface CodemodResult {
    code: string;
    changed: boolean;
    changes: number;
}
export interface Codemod {
    id: string;
    description: string;
    apply(source: string): CodemodResult;
}
/**
 * Build a codemod that renames a whole-word identifier (`from` → `to`) wherever
 * it appears as a standalone token. Word boundaries prevent partial matches
 * (e.g. renaming `Foo` won't touch `FooBar`).
 */
export declare function renameIdentifierCodemod(id: string, from: string, to: string, description: string): Codemod;
/** Built-in codemods shipped with the framework, applied in order. */
export declare const BUILTIN_CODEMODS: Codemod[];
/** List available codemods (id + description). */
export declare function listCodemods(): Array<{
    id: string;
    description: string;
}>;
/** Look up a codemod by id. */
export declare function getCodemod(id: string): Codemod | undefined;
export interface ApplyCodemodsResult {
    code: string;
    changed: boolean;
    totalChanges: number;
    perCodemod: Record<string, number>;
}
/**
 * Apply codemods to a source string. By default all built-ins run, in order;
 * pass `ids` to select a subset. Unknown ids throw. Returns the transformed
 * code plus a per-codemod change tally.
 */
export declare function applyCodemods(source: string, ids?: string[]): ApplyCodemodsResult;
//# sourceMappingURL=codemods.d.ts.map