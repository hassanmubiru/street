export interface PlaygroundOptions {
    /** Page title. Default 'Street API Playground'. */
    title?: string;
    /** Base URL requests are sent to. Default '' (same origin). */
    baseUrl?: string;
}
/**
 * Render an interactive HTML playground for an OpenAPI document. Returns a
 * complete, self-contained HTML page (inline CSS + JS, no external deps).
 */
export declare function openApiToHtml(doc: unknown, opts?: PlaygroundOptions): string;
//# sourceMappingURL=playground.d.ts.map