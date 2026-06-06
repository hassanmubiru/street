// src/graphql/schema.ts
// Hand-written recursive-descent parser for the GraphQL Schema Definition
// Language (SDL). Zero external dependencies — no `graphql-js`.
//
// The parser runs in two stages:
//   1. A lexer (`tokenize`) turns the raw SDL string into a flat token stream,
//      stripping comments and insignificant commas per the GraphQL spec.
//   2. A recursive-descent parser (`Parser`) consumes the token stream and
//      builds an internal AST: object/interface/input/enum/union/scalar type
//      definitions, field definitions with argument and (wrapped) type info,
//      and directives.
//
// The public `parseSchema(sdl)` entry point returns a `ServiceDefinition` that
// is consumed by the GraphQL execution engine. Field/argument types are exposed
// both as a structured `TypeRef` AST (with non-null `!` and list `[]` wrappers)
// and as their canonical SDL string form (e.g. `[User!]!`) for convenience.

'use strict';

// ─── AST Types ──────────────────────────────────────────────────────────────

/** Kind discriminator for a top-level type definition. */
export type TypeDefKind = 'type' | 'input' | 'enum' | 'scalar' | 'interface' | 'union';

/**
 * Structured reference to a type, modelling the non-null (`!`) and list (`[]`)
 * wrappers as a nested tree. For example `[User!]!` parses to:
 *   { kind: 'nonNull', ofType: { kind: 'list', ofType:
 *     { kind: 'nonNull', ofType: { kind: 'named', name: 'User' } } } }
 */
export interface TypeRef {
  kind: 'named' | 'list' | 'nonNull';
  /** Present only when `kind === 'named'`. */
  name?: string;
  /** Present only when `kind === 'list' | 'nonNull'`. */
  ofType?: TypeRef;
}

/** A single name/value pair supplied to a directive at a usage site. */
export interface DirectiveArg {
  name: string;
  value: unknown;
}

/** A directive applied to a definition, field, argument, or enum value. */
export interface DirectiveNode {
  name: string;
  args: DirectiveArg[];
}

/** A field argument definition: `name: Type = default @directive`. */
export interface ArgDef {
  name: string;
  /** Canonical SDL string form of the type, e.g. `ID!`. Kept for convenience. */
  type: string;
  /** Structured type reference including non-null/list wrappers. */
  typeRef: TypeRef;
  /** Parsed default value, if a `= value` clause is present. */
  defaultValue?: unknown;
  directives?: DirectiveNode[];
  description?: string;
}

/** A field definition on an object/interface/input type. */
export interface FieldDef {
  name: string;
  /** Canonical SDL string form of the return type, e.g. `[User!]!`. */
  type: string;
  /** Structured type reference including non-null/list wrappers. */
  typeRef: TypeRef;
  /** Field arguments, if any. `undefined` when the field takes no arguments. */
  args?: ArgDef[];
  directives?: DirectiveNode[];
  description?: string;
}

/** A single enum value definition: `VALUE @directive`. */
export interface EnumValueDef {
  name: string;
  directives?: DirectiveNode[];
  description?: string;
}

/** A top-level type definition. */
export interface TypeDef {
  name: string;
  kind: TypeDefKind;
  /** Fields for object/interface/input types; empty for scalar/enum/union. */
  fields: FieldDef[];
  /** Interface names listed in an `implements A & B` clause. */
  interfaces?: string[];
  /** Member type names of a union: `union U = A | B`. */
  unionMembers?: string[];
  /** Values of an enum type. */
  enumValues?: EnumValueDef[];
  directives?: DirectiveNode[];
  description?: string;
}

/** A directive *definition*: `directive @name(args) on LOCATIONS`. */
export interface DirectiveDef {
  name: string;
  args: ArgDef[];
  locations: string[];
  repeatable: boolean;
  description?: string;
}

/** The complete parsed schema AST. */
export interface ServiceDefinition {
  types: TypeDef[];
  queryType?: string;
  mutationType?: string;
  subscriptionType?: string;
  /** Directive definitions declared in the SDL. */
  directiveDefs: DirectiveDef[];
}

/** Convenience alias: the schema AST produced by {@link parseSchema}. */
export type SchemaAst = ServiceDefinition;

/** Error thrown when the SDL is syntactically invalid. */
export class SchemaParseError extends Error {
  readonly line: number;
  readonly column: number;
  constructor(message: string, line: number, column: number) {
    super(`${message} (line ${line}, column ${column})`);
    this.name = 'SchemaParseError';
    this.line = line;
    this.column = column;
  }
}

// ─── Lexer ────────────────────────────────────────────────────────────────────

type TokenKind = 'name' | 'int' | 'float' | 'string' | 'punct' | 'eof';

interface Token {
  kind: TokenKind;
  value: string;
  line: number;
  column: number;
}

const PUNCTUATORS = new Set(['!', '$', '(', ')', ':', '=', '@', '[', ']', '{', '}', '|', '&']);

function isNameStart(ch: string): boolean {
  return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_';
}

function isNameCont(ch: string): boolean {
  return isNameStart(ch) || (ch >= '0' && ch <= '9');
}

function isDigit(ch: string): boolean {
  return ch >= '0' && ch <= '9';
}

/** Turn an SDL string into a token stream, discarding comments and commas. */
function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  let line = 1;
  let col = 1;

  const advance = (n = 1): void => {
    for (let k = 0; k < n; k++) {
      if (src[i] === '\n') { line++; col = 1; } else { col++; }
      i++;
    }
  };

  while (i < src.length) {
    const ch = src[i]!;

    // Whitespace, BOM, and insignificant commas.
    if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n' || ch === ',' || ch === '\uFEFF') {
      advance();
      continue;
    }

    // Comments run to end of line.
    if (ch === '#') {
      while (i < src.length && src[i] !== '\n') advance();
      continue;
    }

    const startLine = line;
    const startCol = col;

    // Block string: """ ... """
    if (ch === '"' && src[i + 1] === '"' && src[i + 2] === '"') {
      advance(3);
      let value = '';
      while (i < src.length && !(src[i] === '"' && src[i + 1] === '"' && src[i + 2] === '"')) {
        value += src[i];
        advance();
      }
      if (i >= src.length) throw new SchemaParseError('Unterminated block string', startLine, startCol);
      advance(3);
      tokens.push({ kind: 'string', value: dedentBlockString(value), line: startLine, column: startCol });
      continue;
    }

    // Single-line string: " ... "
    if (ch === '"') {
      advance();
      let value = '';
      while (i < src.length && src[i] !== '"' && src[i] !== '\n') {
        if (src[i] === '\\') {
          advance();
          value += decodeEscape(src[i]);
        } else {
          value += src[i];
        }
        advance();
      }
      if (src[i] !== '"') throw new SchemaParseError('Unterminated string', startLine, startCol);
      advance();
      tokens.push({ kind: 'string', value, line: startLine, column: startCol });
      continue;
    }

    // Numbers (int or float), with optional leading minus.
    if (isDigit(ch) || (ch === '-' && isDigit(src[i + 1] ?? ''))) {
      let value = '';
      let isFloat = false;
      if (ch === '-') { value += '-'; advance(); }
      while (i < src.length && isDigit(src[i]!)) { value += src[i]; advance(); }
      if (src[i] === '.') {
        isFloat = true;
        value += '.'; advance();
        while (i < src.length && isDigit(src[i]!)) { value += src[i]; advance(); }
      }
      if (src[i] === 'e' || src[i] === 'E') {
        isFloat = true;
        value += src[i]; advance();
        if (src[i] === '+' || src[i] === '-') { value += src[i]; advance(); }
        while (i < src.length && isDigit(src[i]!)) { value += src[i]; advance(); }
      }
      tokens.push({ kind: isFloat ? 'float' : 'int', value, line: startLine, column: startCol });
      continue;
    }

    // Names / keywords.
    if (isNameStart(ch)) {
      let value = '';
      while (i < src.length && isNameCont(src[i]!)) { value += src[i]; advance(); }
      tokens.push({ kind: 'name', value, line: startLine, column: startCol });
      continue;
    }

    // Spread (...) — accepted and ignored by the SDL parser if present.
    if (ch === '.' && src[i + 1] === '.' && src[i + 2] === '.') {
      advance(3);
      tokens.push({ kind: 'punct', value: '...', line: startLine, column: startCol });
      continue;
    }

    // Punctuators.
    if (PUNCTUATORS.has(ch)) {
      advance();
      tokens.push({ kind: 'punct', value: ch, line: startLine, column: startCol });
      continue;
    }

    throw new SchemaParseError(`Unexpected character '${ch}'`, startLine, startCol);
  }

  tokens.push({ kind: 'eof', value: '', line, column: col });
  return tokens;
}

function decodeEscape(ch: string | undefined): string {
  switch (ch) {
    case 'n': return '\n';
    case 't': return '\t';
    case 'r': return '\r';
    case 'b': return '\b';
    case 'f': return '\f';
    case '/': return '/';
    case '\\': return '\\';
    case '"': return '"';
    default: return ch ?? '';
  }
}

/** Remove common leading indentation from a block string per the spec. */
function dedentBlockString(raw: string): string {
  const lines = raw.split('\n');
  let commonIndent = Infinity;
  for (let k = 1; k < lines.length; k++) {
    const lineStr = lines[k]!;
    const trimmed = lineStr.trimStart();
    if (trimmed.length > 0) {
      commonIndent = Math.min(commonIndent, lineStr.length - trimmed.length);
    }
  }
  if (commonIndent !== Infinity) {
    for (let k = 1; k < lines.length; k++) lines[k] = lines[k]!.slice(commonIndent);
  }
  while (lines.length > 0 && lines[0]!.trim() === '') lines.shift();
  while (lines.length > 0 && lines[lines.length - 1]!.trim() === '') lines.pop();
  return lines.join('\n');
}

// ─── Recursive-Descent Parser ──────────────────────────────────────────────────

const TYPE_KEYWORDS = new Set(['type', 'input', 'enum', 'scalar', 'interface', 'union']);

class Parser {
  private readonly tokens: Token[];
  private pos = 0;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  private peek(offset = 0): Token {
    return this.tokens[Math.min(this.pos + offset, this.tokens.length - 1)]!;
  }

  private next(): Token {
    const tok = this.tokens[this.pos]!;
    if (this.pos < this.tokens.length - 1) this.pos++;
    return tok;
  }

  private isEof(): boolean {
    return this.peek().kind === 'eof';
  }

  private fail(message: string, tok: Token = this.peek()): never {
    throw new SchemaParseError(message, tok.line, tok.column);
  }

  private isPunct(value: string, offset = 0): boolean {
    const tok = this.peek(offset);
    return tok.kind === 'punct' && tok.value === value;
  }

  private isName(value?: string, offset = 0): boolean {
    const tok = this.peek(offset);
    return tok.kind === 'name' && (value === undefined || tok.value === value);
  }

  private expectPunct(value: string): Token {
    if (!this.isPunct(value)) this.fail(`Expected '${value}' but found '${this.peek().value || 'EOF'}'`);
    return this.next();
  }

  private expectName(): string {
    const tok = this.peek();
    if (tok.kind !== 'name') this.fail(`Expected a name but found '${tok.value || 'EOF'}'`);
    return this.next().value;
  }

  /** Optional leading description string (single or block string literal). */
  private takeDescription(): string | undefined {
    if (this.peek().kind === 'string') return this.next().value;
    return undefined;
  }

  parse(): ServiceDefinition {
    const types: TypeDef[] = [];
    const directiveDefs: DirectiveDef[] = [];
    let queryType: string | undefined;
    let mutationType: string | undefined;
    let subscriptionType: string | undefined;

    while (!this.isEof()) {
      const description = this.takeDescription();
      const tok = this.peek();

      if (tok.kind !== 'name') this.fail(`Unexpected token '${tok.value || 'EOF'}'`);

      // `extend` definitions are parsed by re-using the underlying definition.
      if (tok.value === 'extend') this.next();

      const keyword = this.peek().value;

      if (keyword === 'schema') {
        const ops = this.parseSchemaDefinition();
        queryType = ops.query ?? queryType;
        mutationType = ops.mutation ?? mutationType;
        subscriptionType = ops.subscription ?? subscriptionType;
        continue;
      }

      if (keyword === 'directive') {
        directiveDefs.push(this.parseDirectiveDefinition(description));
        continue;
      }

      if (TYPE_KEYWORDS.has(keyword)) {
        types.push(this.parseTypeDefinition(description));
        continue;
      }

      this.fail(`Unknown definition keyword '${keyword}'`);
    }

    // Infer root operation type names when no explicit `schema {}` block exists.
    if (queryType === undefined && types.some((t) => t.name === 'Query')) queryType = 'Query';
    if (mutationType === undefined && types.some((t) => t.name === 'Mutation')) mutationType = 'Mutation';
    if (subscriptionType === undefined && types.some((t) => t.name === 'Subscription')) {
      subscriptionType = 'Subscription';
    }

    return { types, queryType, mutationType, subscriptionType, directiveDefs };
  }

  private parseSchemaDefinition(): { query?: string; mutation?: string; subscription?: string } {
    this.expectKeyword('schema');
    this.parseDirectives();
    this.expectPunct('{');
    const ops: { query?: string; mutation?: string; subscription?: string } = {};
    while (!this.isPunct('}') && !this.isEof()) {
      const opName = this.expectName();
      this.expectPunct(':');
      const typeName = this.expectName();
      if (opName === 'query') ops.query = typeName;
      else if (opName === 'mutation') ops.mutation = typeName;
      else if (opName === 'subscription') ops.subscription = typeName;
      else this.fail(`Invalid root operation '${opName}'`);
    }
    this.expectPunct('}');
    return ops;
  }

  private expectKeyword(word: string): void {
    if (!this.isName(word)) this.fail(`Expected '${word}'`);
    this.next();
  }

  private parseTypeDefinition(description: string | undefined): TypeDef {
    const keyword = this.next().value as TypeDefKind;

    switch (keyword) {
      case 'scalar': {
        const name = this.expectName();
        const directives = this.parseDirectives();
        return { name, kind: 'scalar', fields: [], directives: orUndefined(directives), description };
      }
      case 'union':
        return this.parseUnion(description);
      case 'enum':
        return this.parseEnum(description);
      case 'type':
      case 'interface':
      case 'input':
        return this.parseObjectLike(keyword, description);
      default:
        return this.fail(`Unsupported type keyword '${keyword}'`);
    }
  }

  private parseObjectLike(kind: 'type' | 'interface' | 'input', description: string | undefined): TypeDef {
    const name = this.expectName();

    // `implements A & B` clause (object/interface types only).
    let interfaces: string[] | undefined;
    if (this.isName('implements')) {
      this.next();
      interfaces = [];
      // Optional leading `&`.
      if (this.isPunct('&')) this.next();
      interfaces.push(this.expectName());
      while (this.isPunct('&')) {
        this.next();
        interfaces.push(this.expectName());
      }
    }

    const directives = this.parseDirectives();

    const fields: FieldDef[] = [];
    if (this.isPunct('{')) {
      this.expectPunct('{');
      while (!this.isPunct('}') && !this.isEof()) {
        fields.push(this.parseFieldDefinition());
      }
      this.expectPunct('}');
    }

    return {
      name,
      kind,
      fields,
      interfaces: orUndefined(interfaces),
      directives: orUndefined(directives),
      description,
    };
  }

  private parseFieldDefinition(): FieldDef {
    const description = this.takeDescription();
    const name = this.expectName();

    // Arguments definition: `( arg: Type = default @dir, ... )`.
    let args: ArgDef[] | undefined;
    if (this.isPunct('(')) {
      this.expectPunct('(');
      args = [];
      while (!this.isPunct(')') && !this.isEof()) {
        args.push(this.parseInputValueDefinition());
      }
      this.expectPunct(')');
    }

    this.expectPunct(':');
    const typeRef = this.parseTypeRef();
    const directives = this.parseDirectives();

    return {
      name,
      type: typeRefToString(typeRef),
      typeRef,
      args: orUndefined(args),
      directives: orUndefined(directives),
      description,
    };
  }

  private parseInputValueDefinition(): ArgDef {
    const description = this.takeDescription();
    const name = this.expectName();
    this.expectPunct(':');
    const typeRef = this.parseTypeRef();

    let defaultValue: unknown;
    let hasDefault = false;
    if (this.isPunct('=')) {
      this.next();
      defaultValue = this.parseValue();
      hasDefault = true;
    }

    const directives = this.parseDirectives();

    const def: ArgDef = {
      name,
      type: typeRefToString(typeRef),
      typeRef,
      directives: orUndefined(directives),
      description,
    };
    if (hasDefault) def.defaultValue = defaultValue;
    return def;
  }

  private parseUnion(description: string | undefined): TypeDef {
    const name = this.expectName();
    const directives = this.parseDirectives();
    const members: string[] = [];
    if (this.isPunct('=')) {
      this.next();
      if (this.isPunct('|')) this.next();
      members.push(this.expectName());
      while (this.isPunct('|')) {
        this.next();
        members.push(this.expectName());
      }
    }
    return {
      name,
      kind: 'union',
      fields: [],
      unionMembers: members,
      directives: orUndefined(directives),
      description,
    };
  }

  private parseEnum(description: string | undefined): TypeDef {
    const name = this.expectName();
    const directives = this.parseDirectives();
    const enumValues: EnumValueDef[] = [];
    if (this.isPunct('{')) {
      this.expectPunct('{');
      while (!this.isPunct('}') && !this.isEof()) {
        const valueDescription = this.takeDescription();
        const valueName = this.expectName();
        const valueDirectives = this.parseDirectives();
        enumValues.push({
          name: valueName,
          directives: orUndefined(valueDirectives),
          description: valueDescription,
        });
      }
      this.expectPunct('}');
    }
    return {
      name,
      kind: 'enum',
      fields: [],
      enumValues,
      directives: orUndefined(directives),
      description,
    };
  }

  private parseDirectiveDefinition(description: string | undefined): DirectiveDef {
    this.expectKeyword('directive');
    this.expectPunct('@');
    const name = this.expectName();

    const args: ArgDef[] = [];
    if (this.isPunct('(')) {
      this.expectPunct('(');
      while (!this.isPunct(')') && !this.isEof()) {
        args.push(this.parseInputValueDefinition());
      }
      this.expectPunct(')');
    }

    let repeatable = false;
    if (this.isName('repeatable')) {
      this.next();
      repeatable = true;
    }

    this.expectKeyword('on');
    const locations: string[] = [];
    if (this.isPunct('|')) this.next();
    locations.push(this.expectName());
    while (this.isPunct('|')) {
      this.next();
      locations.push(this.expectName());
    }

    return { name, args, locations, repeatable, description };
  }

  /** Parse a type reference with list `[]` and non-null `!` wrappers. */
  private parseTypeRef(): TypeRef {
    let ref: TypeRef;
    if (this.isPunct('[')) {
      this.next();
      const inner = this.parseTypeRef();
      this.expectPunct(']');
      ref = { kind: 'list', ofType: inner };
    } else {
      const name = this.expectName();
      ref = { kind: 'named', name };
    }
    if (this.isPunct('!')) {
      this.next();
      ref = { kind: 'nonNull', ofType: ref };
    }
    return ref;
  }

  /** Parse zero or more directive applications: `@name(args)`. */
  private parseDirectives(): DirectiveNode[] {
    const directives: DirectiveNode[] = [];
    while (this.isPunct('@')) {
      this.next();
      const name = this.expectName();
      const args: DirectiveArg[] = [];
      if (this.isPunct('(')) {
        this.expectPunct('(');
        while (!this.isPunct(')') && !this.isEof()) {
          const argName = this.expectName();
          this.expectPunct(':');
          const value = this.parseValue();
          args.push({ name: argName, value });
        }
        this.expectPunct(')');
      }
      directives.push({ name, args });
    }
    return directives;
  }

  /** Parse a literal value: scalars, enums, variables, lists, and objects. */
  private parseValue(): unknown {
    const tok = this.peek();

    if (tok.kind === 'string') return this.next().value;
    if (tok.kind === 'int') return parseInt(this.next().value, 10);
    if (tok.kind === 'float') return parseFloat(this.next().value);

    if (tok.kind === 'punct') {
      if (tok.value === '$') {
        this.next();
        return { variable: this.expectName() };
      }
      if (tok.value === '[') {
        this.next();
        const list: unknown[] = [];
        while (!this.isPunct(']') && !this.isEof()) list.push(this.parseValue());
        this.expectPunct(']');
        return list;
      }
      if (tok.value === '{') {
        this.next();
        const obj: Record<string, unknown> = {};
        while (!this.isPunct('}') && !this.isEof()) {
          const key = this.expectName();
          this.expectPunct(':');
          obj[key] = this.parseValue();
        }
        this.expectPunct('}');
        return obj;
      }
    }

    if (tok.kind === 'name') {
      const word = this.next().value;
      if (word === 'true') return true;
      if (word === 'false') return false;
      if (word === 'null') return null;
      // Bare names are enum values.
      return word;
    }

    return this.fail(`Unexpected value token '${tok.value || 'EOF'}'`);
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Render a {@link TypeRef} back into canonical SDL string form. */
export function typeRefToString(ref: TypeRef): string {
  switch (ref.kind) {
    case 'named':
      return ref.name ?? '';
    case 'list':
      return `[${typeRefToString(ref.ofType!)}]`;
    case 'nonNull':
      return `${typeRefToString(ref.ofType!)}!`;
  }
}

/** Strip non-null `!` and list `[]` wrappers, returning the named type. */
export function namedType(ref: TypeRef): string {
  let cur = ref;
  while (cur.kind !== 'named') cur = cur.ofType!;
  return cur.name ?? '';
}

function orUndefined<T>(arr: T[] | undefined): T[] | undefined {
  return arr && arr.length > 0 ? arr : undefined;
}

// ─── Public Entry Point ─────────────────────────────────────────────────────

/**
 * Parse a GraphQL SDL string into a {@link ServiceDefinition} AST.
 *
 * @throws {SchemaParseError} when the SDL is syntactically invalid.
 */
export function parseSchema(sdl: string): ServiceDefinition {
  const tokens = tokenize(sdl);
  return new Parser(tokens).parse();
}
