// src/microservices/grpc/proto-parser.ts
// Minimal protobuf-3 .proto parser: extracts service/RPC and message
// definitions into ASTs used for codegen and server dispatch. node:fs only.
import { readFile } from 'node:fs/promises';
/**
 * Strip `//` line comments and `/* *\/` block comments in a single O(n) pass.
 *
 * Mirrors the original regex semantics exactly:
 *  - block comment `/* … *\/`: first `*\/` terminates; if unterminated, consume to end-of-input
 *  - line comment `// …`: consume to end-of-line (the trailing newline is preserved)
 *  - all other characters are copied through unchanged
 *
 * A linear scanner avoids the super-linear backtracking that the lazy
 * `/\/\*[\s\S]*?\*\//g` pattern exhibits on unterminated `/*` openers.
 */
function stripComments(src) {
    let out = '';
    let i = 0;
    const n = src.length;
    while (i < n) {
        const c = src[i];
        const d = src[i + 1];
        if (c === '/' && d === '*') {
            // block comment: skip to first '*/'
            i += 2;
            while (i < n && !(src[i] === '*' && src[i + 1] === '/'))
                i++;
            i += 2; // consume closing '*/' (or run off the end if unterminated)
        }
        else if (c === '/' && d === '/') {
            // line comment: skip to end of line (newline left in place)
            i += 2;
            while (i < n && src[i] !== '\n')
                i++;
        }
        else {
            out += c;
            i++;
        }
    }
    return out;
}
/** Parse a `.proto` source string into a {@link ProtoAst}. */
export function parseProto(src) {
    const text = stripComments(src);
    const pkgMatch = /package\s+([\w.]+)\s*;/.exec(text);
    const packageName = pkgMatch ? pkgMatch[1] : null;
    const messages = [];
    // Match only the unambiguous header `message <name> {`, then take the body up
    // to the first `}` via a linear indexOf. This mirrors the original
    // `\{([^}]*)\}` semantics (body is everything up to the first closing brace,
    // which must exist) without the polynomial backtracking the unanchored global
    // `[^}]*` regex exhibited when retried at every `message` start (js/polynomial-redos).
    const messageRe = /message\s+(\w+)\s*\{/g;
    let m;
    while ((m = messageRe.exec(text)) !== null) {
        const name = m[1];
        const bodyStart = messageRe.lastIndex;
        const bodyEnd = text.indexOf('}', bodyStart);
        if (bodyEnd === -1)
            break; // no closing brace: original regex would not match
        const body = text.slice(bodyStart, bodyEnd);
        messageRe.lastIndex = bodyEnd + 1; // continue after the closing brace (non-overlapping)
        const fields = [];
        const fieldRe = /(?:(repeated)\s+)?([\w.]+)\s+(\w+)\s*=\s*(\d+)\s*;/g;
        let f;
        while ((f = fieldRe.exec(body)) !== null) {
            fields.push({ repeated: Boolean(f[1]), type: f[2], name: f[3], number: Number(f[4]) });
        }
        messages.push({ name, fields });
    }
    const services = [];
    // Same linear header-match + indexOf approach as messages above, to avoid the
    // polynomial backtracking of the unanchored global `\{([^}]*)\}` (js/polynomial-redos).
    const serviceRe = /service\s+(\w+)\s*\{/g;
    let s;
    while ((s = serviceRe.exec(text)) !== null) {
        const name = s[1];
        const bodyStart = serviceRe.lastIndex;
        const bodyEnd = text.indexOf('}', bodyStart);
        if (bodyEnd === -1)
            break; // no closing brace: original regex would not match
        const body = text.slice(bodyStart, bodyEnd);
        serviceRe.lastIndex = bodyEnd + 1; // continue after the closing brace (non-overlapping)
        const rpcs = [];
        const rpcRe = /rpc\s+(\w+)\s*\(\s*(stream\s+)?([\w.]+)\s*\)\s*returns\s*\(\s*(stream\s+)?([\w.]+)\s*\)/g;
        let r;
        while ((r = rpcRe.exec(body)) !== null) {
            rpcs.push({
                name: r[1],
                clientStreaming: Boolean(r[2]),
                requestType: r[3],
                serverStreaming: Boolean(r[4]),
                responseType: r[5],
            });
        }
        services.push({ name, rpcs });
    }
    return { packageName, messages, services };
}
/** Read and parse a `.proto` file from disk. */
export async function parseProtoFile(path) {
    const src = await readFile(path, 'utf8');
    return parseProto(src);
}
/** Map protobuf scalar types to TypeScript types for codegen. */
export function protoTypeToTs(type) {
    switch (type) {
        case 'double':
        case 'float':
        case 'int32':
        case 'int64':
        case 'uint32':
        case 'uint64':
        case 'sint32':
        case 'sint64':
        case 'fixed32':
        case 'fixed64': return 'number';
        case 'bool': return 'boolean';
        case 'string': return 'string';
        case 'bytes': return 'Uint8Array';
        default: return type; // message type reference
    }
}
/** Generate TypeScript interface + service-handler typings from a ProtoAst. */
export function generateGrpcTypes(ast) {
    const lines = ['// Auto-generated by `street generate grpc` — do not edit.', ''];
    for (const msg of ast.messages) {
        lines.push(`export interface ${msg.name} {`);
        for (const field of msg.fields) {
            const tsType = protoTypeToTs(field.type);
            lines.push(`  ${field.name}: ${tsType}${field.repeated ? '[]' : ''};`);
        }
        lines.push('}', '');
    }
    for (const svc of ast.services) {
        lines.push(`export interface ${svc.name}Handlers {`);
        for (const rpc of svc.rpcs) {
            lines.push(`  ${rpc.name}(request: ${rpc.requestType}): Promise<${rpc.responseType}>;`);
        }
        lines.push('}', '');
    }
    return lines.join('\n');
}
//# sourceMappingURL=proto-parser.js.map