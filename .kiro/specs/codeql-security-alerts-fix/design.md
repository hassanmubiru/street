# CodeQL Security Alerts Fix — Bugfix Design

## Overview

This design addresses a batch of CodeQL static-analysis alerts on `main`, organized into six defect
classes (A–F). The unifying strategy is **targeted, minimal change per alert with strict behavior
preservation for all non-buggy inputs**: each fix narrows or removes only the unsafe path that
triggers the bug condition, while every currently-correct code path returns identical results.

The classes and their fix strategies are:

- **A — Disabled TLS validation** (`webhook/dispatcher.ts`): remove the code path that can set
  `rejectUnauthorized: false`, so certificate validation is never disabled.
- **B — Polynomial / ReDoS regex** (`auth/mfa.ts`, `cli/.../generate.ts`, `grpc/proto-parser.ts`):
  replace each super-linear pattern with a linear-time equivalent (string ops, `path.basename`, and
  a single-pass comment scanner) that produces identical output for well-formed input.
- **C — Incomplete string escaping** (`scripts/generate-sbom.mjs`): replace the single-occurrence
  `String.prototype.replace(string, …)` with a global replacement so every special character is
  encoded.
- **D — Incomplete multi-character sanitization** (`security/xss.ts`, alert on `dist/security/xss.js`):
  drive `sanitizeString` to a true fixed point (loop until stable) and rebuild `dist` so the shipped
  artifact matches the corrected source.
- **E — Protocol-mandated password hashing** (`database/mysql/wire.ts` + MySQL auth test fixtures):
  no behavioral change — the SHA1/SHA256 computations implement the MySQL wire protocol exactly.
  Resolve the alerts with a documented inline suppression + rationale.
- **F — Missing workflow permissions** (seven GitHub Actions workflows): add an explicit top-level
  least-privilege `permissions` block (`contents: read`) to each.

Each fix is validated against the bug condition (`isBugCondition_*`) and the cross-class preservation
property already specified in `bugfix.md`.

## Glossary

- **Bug_Condition (C)**: The input/condition that triggers a given defect. Defined per class as
  `isBugCondition_A` … `isBugCondition_F` in `bugfix.md`.
- **Property (P)**: The desired corrected behavior for inputs satisfying the bug condition.
- **Preservation**: For every input NOT satisfying any bug condition, the fixed code (`F'`) produces
  the same observable result as the original code (`F`).
- **`F` / `F'`**: Original (unfixed) and fixed code, respectively.
- **`sendRequest`** (`webhook/dispatcher.ts`): builds the `node:https` request options and dispatches
  the signed webhook payload.
- **`base32Decode`** (`auth/mfa.ts`): decodes an RFC 4648 base32 string; strips padding/whitespace
  before decoding.
- **`generateGrpc`** (`cli/src/commands/generate.ts`): derives an output filename from a user-supplied
  `--proto <path>` argument.
- **`stripComments`** (`grpc/proto-parser.ts`): removes `//` line and `/* */` block comments from
  `.proto` source before parsing.
- **`buildPurl`** (`scripts/generate-sbom.mjs`, inline expression): constructs a CycloneDX package URL
  (purl) from a dependency name + version.
- **`sanitizeString`** (`security/xss.ts`): removes dangerous substrings (angle brackets, `javascript:`
  / `data:` / `vbscript:` protocols, `on*=` handlers, null bytes) from a string value.
- **`nativePasswordHash` / `sha2PasswordHash`** (`database/mysql/wire.ts`): compute the
  `mysql_native_password` and `caching_sha2_password` challenge-response scrambles for the MySQL
  Client/Server protocol.
- **least-privilege `permissions`**: an explicit top-level GitHub Actions `permissions:` block scoping
  the job `GITHUB_TOKEN` to the minimum required (here, `contents: read`).

## Bug Details

### Bug Condition

The batch contains six independent bug conditions. Each is reproduced from `bugfix.md` and mapped to
the exact source location confirmed during investigation.

#### Class A — Disabled TLS certificate validation

`sendRequest` spreads `rejectUnauthorized: false` into the HTTPS options whenever a target sets
`tls.rejectUnauthorized === false`, disabling certificate validation.

```
FUNCTION isBugCondition_A(target)
  INPUT: target of type WebhookTarget
  OUTPUT: boolean
  RETURN target.tls != null AND target.tls.rejectUnauthorized = false
END FUNCTION
```

Confirmed location — `packages/core/src/webhook/dispatcher.ts`, inside `sendRequest`:

```ts
...(tls?.ca ? { ca: tls.ca } : {}),
...(tls?.rejectUnauthorized === false ? { rejectUnauthorized: false } : {}),  // ← flagged
```

#### Class B — Polynomial regular expression on uncontrolled data (ReDoS)

```
FUNCTION isBugCondition_B(input)
  INPUT: input of type string   // uncontrolled data reaching the flagged regex
  OUTPUT: boolean
  RETURN true   // every input is processed by the flagged pattern
END FUNCTION
```

Three confirmed locations:

- `packages/core/src/auth/mfa.ts:31` — `base32Decode`:
  `input.toUpperCase().replace(/=+$/g, '').replace(/\s/g, '')`. The `=+$` pattern backtracks
  quadratically against a long run of `=` not anchored at end (e.g. `"="*n + "A"`).
- `packages/cli/src/commands/generate.ts:126` — `generateGrpc`:
  `protoPath.replace(/.*\//, '')`. The unanchored greedy `.*\/` retries from each start position when
  no `/` is present, giving O(n²) on a long slash-free argument.
- `packages/core/src/microservices/grpc/proto-parser.ts:40` — `stripComments`:
  `src.replace(/\/\*[\s\S]*?\*\//g, '')`. For input containing many unterminated `/*` sequences, the
  lazy `[\s\S]*?\*\/` rescans toward end-of-input for each `/*`, giving O(n²).

#### Class C — Incomplete string escaping (purl)

```
FUNCTION isBugCondition_C(name)
  INPUT: name of type string   // package name
  OUTPUT: boolean
  RETURN name contains a character requiring escaping beyond the first occurrence
END FUNCTION
```

Confirmed location — `scripts/generate-sbom.mjs:44`:

```js
const purl = `pkg:npm/${dp.name.replace('@', '%40')}@${dp.version}`;  // first '@' only
```

`String.prototype.replace` with a **string** first argument replaces only the first occurrence, so any
name with more than one character requiring escaping is left partially encoded.

#### Class D — Incomplete multi-character sanitization

```
FUNCTION isBugCondition_D(input)
  INPUT: input of type string
  OUTPUT: boolean
  RETURN sanitizeOnce(input) still contains a dangerous substring
END FUNCTION
```

The alert points at build output `dist/security/xss.js`, whose `sanitizeString` performs a **single
pass** of replacements. A single pass can be reconstituted: removing one match can splice two
fragments into a new dangerous substring (e.g. `java<script>script:` → after one removal →
`javascript:`). The source `packages/core/src/security/xss.ts` already loops, but caps at
`MAX_SANITIZE_PASSES = 10`, which is not guaranteed to reach a stable fixed point, and the shipped
`dist` artifact is stale relative to the source.

#### Class E — Protocol-mandated password hashing (suppression/justification)

```
FUNCTION isBugCondition_E(callSite)
  INPUT: callSite   // a flagged SHA1/SHA256 use in MySQL wire/auth code
  OUTPUT: boolean
  RETURN callSite implements the MySQL wire-protocol challenge-response
END FUNCTION
```

Confirmed locations:

- `packages/core/src/database/mysql/wire.ts:84` — `nativePasswordHash`: `createHash('sha1')`
  implementing `SHA1(pw) XOR SHA1(seed || SHA1(SHA1(pw)))`.
- `packages/core/src/database/mysql/wire.ts:112` — `sha2PasswordHash`: `createHash('sha256')`
  implementing `XOR(SHA256(pw), SHA256(SHA256(SHA256(pw)) || seed))`.
- `packages/core/src/tests/mysql-native-password.test.ts` — `createHash('sha1')` reference scramble
  and inline checks.
- `packages/core/src/tests/mysql-caching-sha2-password.test.ts` — `createHash('sha256')` reference
  scramble and inline checks.

These are challenge-response scrambles defined by the MySQL Client/Server protocol, not at-rest
password storage; the hash algorithm and iteration count are fixed by the protocol and cannot be
strengthened without breaking authentication.

#### Class F — Workflow missing top-level permissions

```
FUNCTION isBugCondition_F(workflow)
  INPUT: workflow   // a GitHub Actions workflow file
  OUTPUT: boolean
  RETURN workflow has no top-level `permissions` block
END FUNCTION
```

Confirmed: seven workflows declare no top-level `permissions:` block —
`vendor-integration.yml`, `observability.yml`, `deploy-verify.yml`, `dast.yml`,
`browser-compat.yml`, `kafka-integration.yml`, `rabbitmq-integration.yml`. Each runs with the
repository default `GITHUB_TOKEN` scope, broader than its jobs need.

### Examples

- **A**: `dispatch({ url:'https://evil.example', tls:{ rejectUnauthorized:false } })` — expected: TLS
  validation stays on and a forged certificate is rejected; actual: validation disabled, payload sent
  to an unverified endpoint.
- **B (mfa)**: `base32Decode('='.repeat(100000) + 'A')` — expected: bounded time, then throws on the
  invalid `=`; actual: quadratic backtracking on the `=+$` strip.
- **B (generate)**: `street generate grpc --proto <50k chars, no slash>` — expected: linear basename
  derivation; actual: quadratic backtracking in `/.*\//`.
- **B (proto-parser)**: `parseProto('/*'.repeat(50000))` — expected: linear comment strip; actual:
  quadratic rescan.
- **C**: a dependency named `a@b@c` → expected `a%40b%40c`; actual `a%40b@c` (second `@` unescaped).
- **D**: `sanitizeString('<scr<script>ipt>')` / `'java<>script:'` — expected: result contains no
  dangerous substring after stabilization; actual (single-pass dist): a residual dangerous substring
  can survive.
- **E**: `nativePasswordHash('password', SEED)` must remain
  `c17d6009a5cb47e59f7483fcf05553bbbf7dd0d6` — unchanged (protocol-correct); the only defect is the
  missing documented justification.
- **F**: `dast.yml` runs with default token scope — expected: explicit `permissions: { contents: read }`.

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**

- **A**: Normal webhook dispatch — HTTPS targets with default/`true` `rejectUnauthorized`, with or
  without a custom `tls.ca` — continues to dispatch, HMAC-SHA256 sign, retry, and enforce
  SSRF/blocked-address protection exactly as before.
- **B**: For well-formed input, `base32Decode` returns the same buffer (and still throws on invalid
  characters), `generateGrpc` derives the same output filename, and `parseProto` produces the same AST.
- **C**: Package names with no characters requiring escaping (and ordinary single-`@` scoped names)
  produce byte-identical purls and overall SBOM output.
- **D**: Benign input (no dangerous substrings) returns equivalent sanitized output; the existing
  depth (`MAX_DEPTH`), length (`MAX_STRING_LEN`), array (`MAX_ARRAY`), and key-count (`MAX_KEYS`)
  bounds are unchanged.
- **E**: `nativePasswordHash` and `sha2PasswordHash` produce byte-identical output; all known-vector
  and reference-implementation tests continue to pass.
- **F**: All seven workflows complete every step that previously succeeded; no job fails for lack of
  token scope.

**Scope:**

All inputs that do NOT satisfy a class's bug condition must be completely unaffected. This includes,
across classes:

- Mouse/normal webhook configurations and all other dispatcher behavior (A).
- Valid base32 secrets, valid `--proto` paths, and valid `.proto` sources (B).
- Package names without escaping needs (C).
- Benign request bodies and object/array structures (D).
- Any module, workflow, or code path not listed in `bugfix.md` (preservation property 3.7).

> The concrete corrected behavior for buggy inputs is captured in the Correctness Properties section.

## Hypothesized Root Cause

1. **Class A — Intentional dev/self-signed escape hatch left enabled.** A `rejectUnauthorized: false`
   opt-out was added to support private-CA endpoints but provides an unsafe bypass; the safe path
   (custom `tls.ca`) already exists and is sufficient.

2. **Class B — Convenience regexes with ambiguous quantifiers.** Each pattern uses a greedy/lazy
   quantifier adjacent to an anchor or delimiter (`=+$`, `.*\/`, `[\s\S]*?\*\/`) applied to
   externally-influenced strings, producing super-linear backtracking on adversarial input.

3. **Class C — `String.replace(string, …)` semantics.** A string (not a global regex) first argument
   replaces only the first match; the author assumed at most one `@`.

4. **Class D — Single-pass sanitization + stale build artifact.** The shipped `dist` performs one
   replacement pass (reconstitutable); the source loops but caps iterations below a guaranteed fixed
   point, and `dist` was not rebuilt from the corrected source.

5. **Class E — Generic password-hash heuristic on protocol code.** CodeQL's "insufficient password
   hash" query matches any SHA1/SHA256 over a value named like a password, without distinguishing a
   protocol-mandated challenge-response from at-rest credential storage. The code is correct; the gap
   is a missing documented justification.

6. **Class F — Default token scope.** Workflows authored without an explicit `permissions:` block
   inherit the repository default `GITHUB_TOKEN` scope, exceeding least privilege.

## Correctness Properties

Property 1: Bug Condition A — TLS validation never disabled

_For any_ webhook target where `isBugCondition_A` holds (`tls.rejectUnauthorized === false`), the fixed
`sendRequest` SHALL build request options in which `rejectUnauthorized` is never `false` (validation
stays enabled), so no dispatch path transmits over an unverified TLS connection.

**Validates: Requirements 2.1**

Property 2: Bug Condition B — Linear-time matching/parsing

_For any_ string input reaching the flagged patterns in `base32Decode`, `generateGrpc`, and
`stripComments` (`isBugCondition_B` is always true), the fixed code SHALL process the input in linear
time (no super-linear backtracking), and for well-formed input SHALL return the same result as the
original.

**Validates: Requirements 2.2, 2.3, 2.4**

Property 3: Bug Condition C — Complete purl encoding

_For any_ package name where `isBugCondition_C` holds (a character requiring escaping occurs beyond the
first occurrence), the fixed `buildPurl` SHALL encode every such character, leaving no unescaped special
character in the resulting purl.

**Validates: Requirements 2.5**

Property 4: Bug Condition D — Sanitization fixed point

_For any_ input where `isBugCondition_D` holds (`sanitizeOnce(input)` still contains a dangerous
substring), the fixed `sanitizeString` SHALL return a stable result containing no dangerous substring
(applying replacement to a fixed point, so the output cannot be reconstituted).

**Validates: Requirements 2.6**

Property 5: Bug Condition E — Resolved without behavioral change

_For any_ flagged call site where `isBugCondition_E` holds (the SHA1/SHA256 use implements the MySQL
wire-protocol challenge-response), the fixed code SHALL produce byte-identical hash output to the
original AND the alert SHALL be resolved via a documented inline suppression/justification.

**Validates: Requirements 2.7, 2.8**

Property 6: Bug Condition F — Explicit least-privilege permissions

_For any_ of the seven workflows where `isBugCondition_F` holds (no top-level `permissions` block), the
fixed workflow SHALL declare an explicit top-level `permissions` block scoped to the minimum its jobs
require (`contents: read`).

**Validates: Requirements 2.9**

Property 7: Preservation — Non-buggy inputs unchanged

_For any_ input where NONE of `isBugCondition_A..F` holds, the fixed code SHALL produce the same
observable result as the original code (`F(X) = F'(X)`), preserving normal webhook dispatch, valid
base32/proto/CLI handling, no-special-char purls, benign sanitization output and bounds, protocol-correct
MySQL hashing, and all unrelated workflows and modules.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7**

## Fix Implementation

### Changes Required

Each change is the minimal edit that removes the bug condition while preserving all non-buggy paths.

#### Class A — `packages/core/src/webhook/dispatcher.ts` (`sendRequest`)

Remove the spread that can disable certificate validation. The custom-CA path (which is the legitimate
mechanism for private/corporate endpoints) is retained.

```ts
// before
...(tls?.ca ? { ca: tls.ca } : {}),
...(tls?.rejectUnauthorized === false ? { rejectUnauthorized: false } : {}),

// after
...(tls?.ca ? { ca: tls.ca } : {}),
// rejectUnauthorized is never set to false: certificate validation always stays enabled.
// Endpoints served by a private CA must supply tls.ca instead of disabling validation.
```

Supporting change: update the `WebhookTarget.tls` JSDoc to state that `rejectUnauthorized` can no longer
disable validation, and that `tls.ca` is the supported path for private CAs. (The `rejectUnauthorized`
field may be retained in the type for source compatibility but has no effect when `false`.) This is the
only behavioral change for `isBugCondition_A`; targets without `tls` or with `rejectUnauthorized` true/
undefined already produced `{}` for this spread, so their behavior is unchanged.

#### Class B.1 — `packages/core/src/auth/mfa.ts` (`base32Decode`, line ~31)

Replace the backtracking trailing-padding strip with a linear trailing-trim that preserves the exact
output and evaluation order (strip trailing `=`, then whitespace).

```ts
// before
const clean = input.toUpperCase().replace(/=+$/g, '').replace(/\s/g, '');

// after — linear trailing-'=' trim (no regex backtracking)
const upper = input.toUpperCase();
let end = upper.length;
while (end > 0 && upper.charCodeAt(end - 1) === 0x3d /* '=' */) end--;
const clean = upper.slice(0, end).replace(/\s/g, '');
```

`/\s/g` is a single-character class with no backtracking and is left as-is. Output is identical for all
inputs (including malformed ones that still throw on the first invalid character).

#### Class B.2 — `packages/cli/src/commands/generate.ts` (`generateGrpc`, line ~126)

Use `node:path` `basename` (already importing from `node:path`) to derive the filename in linear time.

```ts
// add to existing import
import { resolve, dirname, basename } from 'node:path';

// before
const baseName = protoPath.replace(/.*\//, '').replace(/\.proto$/, '');

// after — linear basename, then strip the .proto extension
const baseName = basename(protoPath).replace(/\.proto$/, '');
```

For POSIX-style `--proto` paths this yields the identical result as the original `/.*\//` strip;
`/\.proto$/` is a single anchored literal with no backtracking and is retained.

#### Class B.3 — `packages/core/src/microservices/grpc/proto-parser.ts` (`stripComments`, line ~40)

Replace the regex-based comment removal with a single-pass linear scanner that mirrors the original
semantics (remove `/* … */` block comments — first `*/` terminates — and `// …` line comments to
end-of-line), with no super-linear backtracking.

```ts
// after — linear single-pass comment stripper
function stripComments(src: string): string {
  let out = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '/' && d === '*') {          // block comment: skip to first '*/'
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i += 2;                              // consume closing '*/' (or run off end)
    } else if (c === '/' && d === '/') {   // line comment: skip to end of line
      i += 2;
      while (i < n && src[i] !== '\n') i++;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}
```

This preserves the original behavior for well-formed `.proto` source (which the existing parser tests
exercise) and is O(n).

#### Class C — `scripts/generate-sbom.mjs` (purl construction, line ~44)

Replace the first-occurrence string replacement with a global replacement so every `@` is encoded.

```js
// before
const purl = `pkg:npm/${dp.name.replace('@', '%40')}@${dp.version}`;

// after — encode all '@' occurrences in the name segment
const purl = `pkg:npm/${dp.name.replace(/@/g, '%40')}@${dp.version}`;
```

The `bom-ref` derives from the same `purl`, so it stays consistent. For ordinary names (no `@`) and
standard single-`@` scoped names, the output is byte-identical to before.

#### Class D — `packages/core/src/security/xss.ts` (`sanitizeString`) + rebuild `dist`

Drive the replacement loop to a true fixed point. Each pass only deletes characters, so string length is
monotonically non-increasing and the loop is guaranteed to terminate; the iteration guard is tied to the
(already bounded) input length rather than an arbitrary small cap.

```ts
// after — loop until stable (fixed point); guaranteed to terminate
let previous: string;
let current = input;
do {
  previous = current;
  current = current
    .replace(NULL_BYTES, '')
    .replace(/[<>]/g, '')
    .replace(SCRIPT_PROTOCOL, '')
    .replace(DATA_PROTOCOL, '')
    .replace(VBSCRIPT_PROTOCOL, '')
    .replace(DANGEROUS_ATTRS, '');
} while (current !== previous);
return current;
```

Then **rebuild the package** so the shipped artifact (`dist/security/xss.js`, the file CodeQL flagged)
is regenerated from the corrected source:

```
npm run build -w packages/core
```

Removing/raising the premature cap is the only behavioral change, and it only affects inputs satisfying
`isBugCondition_D` (those that still contained a dangerous substring after a single/limited pass). Benign
input is unchanged after the first pass and returns identically. All existing bounds (`MAX_DEPTH`,
`MAX_STRING_LEN`, `MAX_ARRAY`, `MAX_KEYS`) are untouched.

#### Class E — `packages/core/src/database/mysql/wire.ts` + MySQL auth tests (documented suppression)

No behavioral change. Add an inline CodeQL suppression comment with a rationale at each flagged call
site, documenting that the computation is a protocol-mandated challenge-response, not at-rest password
storage. The suppression query id must match the rule id shown on the alert (the "Insufficient password
hash" query, e.g. `js/insufficient-password-hash` — confirm the exact id from the alert/SARIF before
committing).

```ts
// wire.ts — nativePasswordHash
// codeql[js/insufficient-password-hash] -- MySQL mysql_native_password wire-protocol
//   challenge-response (SHA1 is mandated by the protocol RFC/spec); this is not at-rest
//   password storage and the algorithm cannot be changed without breaking authentication.
return createHash('sha1').update(data).digest();

// wire.ts — sha2PasswordHash
// codeql[js/insufficient-password-hash] -- MySQL caching_sha2_password wire-protocol
//   challenge-response (SHA256 is mandated by the protocol); not at-rest storage.
return createHash('sha256').update(data).digest();
```

Apply the equivalent suppression comment at the `createHash('sha1')` / `createHash('sha256')` call sites
in `packages/core/src/tests/mysql-native-password.test.ts` and
`packages/core/src/tests/mysql-caching-sha2-password.test.ts`, keeping the decision consistent with the
source (requirement 2.8).

**Fallback if inline suppression is not honored by the org's code-scanning setup:** add a CodeQL config
file (e.g. `.github/codeql/codeql-config.yml`) with a `query-filters` exclusion scoped to the
`js/insufficient-password-hash` rule for these specific paths, and reference it from `codeql.yml` via the
`config-file` input on `github/codeql-action/init`. The justification comments remain in source either
way. No hash output changes under any option.

#### Class F — seven GitHub Actions workflows (least-privilege permissions)

Each of the seven workflows only checks out, builds, and runs tests/scans (the `dast` job additionally
uploads artifacts, which works with the default token and needs no extra scope). The minimal scope is
therefore `contents: read`. Add a top-level block immediately after the `on:` block in each file:

```yaml
permissions:
  contents: read
```

Files: `vendor-integration.yml`, `observability.yml`, `deploy-verify.yml`, `dast.yml`,
`browser-compat.yml`, `kafka-integration.yml`, `rabbitmq-integration.yml`. (The existing `codeql.yml`
already declares per-job `permissions` and is out of scope.) If any job is later found to need more
(e.g. writing artifacts via the releases API), the additional scope would be added at the job level
rather than widening the top-level default.

## Testing Strategy

### Validation Approach

Two phases. First, surface counterexamples that demonstrate each behavioral defect on the **unfixed**
code (classes A–D). Then verify the fix satisfies the bug-condition property and preserves all non-buggy
behavior. For class E (no behavioral change) the "exploratory" step is confirming output equivalence and
that the alert is the only thing that changes; for class F it is asserting the structural presence of the
permissions block.

### Exploratory Bug Condition Checking

**Goal**: Produce counterexamples that demonstrate the bug BEFORE the fix and confirm the root-cause
hypothesis. If a test does not fail on unfixed code as predicted, re-hypothesize.

**Test Plan & Cases**:

1. **A — TLS option leak**: build request options for a target with `tls.rejectUnauthorized === false`
   and assert `rejectUnauthorized === false` is present (demonstrates the leak on unfixed code).
   Refactor `sendRequest` so the options object is unit-testable (extract an options-builder), or assert
   via an `https.request` spy capturing the passed options.
2. **B — Super-linear timing**: feed adversarial inputs (`'='.repeat(N)+'A'` to `base32Decode`; a long
   slash-free string to the `generateGrpc` basename derivation; `'/*'.repeat(N)` to `parseProto`) at
   increasing N and observe non-linear time growth on unfixed code.
3. **C — Partial encoding**: `buildPurl('a@b@c', '1.0.0')` on unfixed code yields `…a%40b@c…` (residual
   `@`).
4. **D — Reconstitution**: `sanitizeString` on the stale single-pass artifact for inputs like
   `'<scr<script>ipt>'` / `'java<>script:'` leaves a residual dangerous substring.

**Expected Counterexamples**:

- A: options contain `rejectUnauthorized: false`.
- B: processing time grows ~quadratically with input size.
- C: a `@` (or other special char) remains unescaped beyond the first.
- D: output still contains a dangerous substring.

### Fix Checking

**Goal**: For all inputs where the bug condition holds, the fixed function produces the expected behavior.

```
// Class A
FOR ALL target WHERE isBugCondition_A(target) DO
  options := buildRequestOptions'(target)
  ASSERT options.rejectUnauthorized != false
END FOR

// Class B
FOR ALL input WHERE isBugCondition_B(input) DO
  ASSERT matchTime'(input) is O(n)
  ASSERT result'(input) = result(input) for all well-formed input
END FOR

// Class C
FOR ALL name WHERE isBugCondition_C(name) DO
  purl := buildPurl'(name)
  ASSERT purl contains no unescaped special character
END FOR

// Class D
FOR ALL input WHERE isBugCondition_D(input) DO
  out := sanitizeString'(input)
  ASSERT out contains no dangerous substring   // stable fixed point
  ASSERT sanitizeString'(out) = out            // idempotent
END FOR

// Class E
FOR ALL callSite WHERE isBugCondition_E(callSite) DO
  ASSERT hashOutput'(callSite) = hashOutput(callSite)   // unchanged
  ASSERT alert resolved via documented suppression/justification
END FOR

// Class F
FOR ALL workflow WHERE isBugCondition_F(workflow) DO
  ASSERT workflow' declares a top-level `permissions` block
  ASSERT declared scopes are the minimum required (contents: read)
END FOR
```

### Preservation Checking

**Goal**: For all inputs where no bug condition holds, the fixed function equals the original.

```
FOR ALL X WHERE NOT (isBugCondition_A(X) OR … OR isBugCondition_F(X)) DO
  ASSERT F(X) = F'(X)
END FOR
```

**Testing Approach**: Property-based testing is recommended for the string/algorithmic classes (B, C, D)
because it samples the input domain broadly and catches edge cases manual tests miss. Capture the
**current** (pre-fix) behavior on non-buggy inputs first, then assert the fixed code reproduces it.

**Test Cases**:

1. **A — normal dispatch preserved**: targets with no `tls`, `tls.ca` only, or `rejectUnauthorized`
   true/undefined dispatch, sign (HMAC-SHA256), retry, and enforce SSRF blocking exactly as before.
2. **B — well-formed equivalence**: `base32Decode` round-trips valid base32 identically (RFC 4648 +
   `base32Encode`); `generateGrpc` derives the same filename for valid `--proto` paths; `parseProto`
   produces an identical AST for the existing proto fixtures.
3. **C — no-special-char purls**: random names without `@` (and standard single-`@` scoped names)
   produce identical purls and identical sorted SBOM `components`.
4. **D — benign equivalence + bounds**: random benign strings return identical sanitized output; depth,
   length, array, and key-count bounds behave identically.
5. **E — protocol vectors**: `nativePasswordHash`/`sha2PasswordHash` reproduce the known vectors and the
   independent reference scrambles (existing tests must pass unchanged).
6. **F — workflow steps**: each workflow's existing steps still run successfully under `contents: read`.

### Unit Tests

- **A**: options-builder/spy test for `rejectUnauthorized === false` (fix) and for normal targets
  (preservation).
- **B**: equivalence tests for `base32Decode`, `generateGrpc` basename, and `stripComments`/`parseProto`
  on valid input; targeted adversarial-input timing/termination tests.
- **C**: `buildPurl` with multi-`@` names (fix) and plain/scoped names (preservation).
- **D**: reconstitution inputs reach a stable, dangerous-substring-free fixed point and are idempotent;
  benign inputs unchanged.
- **E**: existing `mysql-native-password` / `mysql-caching-sha2-password` known-vector and
  reference-implementation tests continue to pass unchanged.

### Property-Based Tests

- **B**: for randomly generated valid base32 strings / proto sources / proto paths, `result'(input) ===
  result(input)`; for adversarial generated inputs, processing completes within a bounded time budget.
- **C**: for random package names, the produced purl contains no unescaped `@`, and for names without
  special characters the purl is unchanged from the original implementation.
- **D**: for random strings, `sanitizeString'` is idempotent (`f(f(x)) === f(x)`) and its output contains
  no dangerous substring; for benign strings it equals the original implementation's output.

### Integration Tests

- **A**: end-to-end dispatch against a test HTTPS server with a self-signed cert is rejected when
  `rejectUnauthorized:false` is requested, and succeeds with a properly trusted cert / supplied `tls.ca`.
- **D**: `xssMiddleware` over a representative request body sanitizes nested structures to a fixed point
  while honoring bounds.
- **E**: the MySQL auth handshake tests exercise `nativePasswordHash`/`sha2PasswordHash` end-to-end and
  pass unchanged.
- **F**: re-run the seven workflows (or validate locally) to confirm all previously-passing steps still
  complete under the new `permissions` block.
- **All**: re-run CodeQL after the changes and confirm each targeted alert (A–F) is resolved and no new
  alerts are introduced.
