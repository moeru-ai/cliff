# `@moeru/cliff` Agent Guide

- Single-package pnpm project: TypeScript, tsdown, Vitest, ESLint (`@moeru/eslint-config`).
- Command tree orchestration for Node.js CLIs with pluggable argv parsers.

## Structure & Responsibilities

- `src/command.ts`: public command DSL (`defineCommand`, `defineGlobalOptions`) and context types.
- `src/options.ts`: options are Standard Schema + Standard JSON Schema. The argv shape is derived synchronously from `~standard.jsonSchema.input()` while `createCli` runs, and values are validated with `~standard.validate`.
- `src/arguments.ts`: positional-argument patterns and their type inference.
- `src/route.ts`: one left-to-right argv pass that selects the command and prepares parser input.
- `src/help.ts`: help rendering. `src/cli.ts`: `createCli`, tree validation, run loop and exit codes.
- `src/main.ts`: the only module bound to `process` (`runMain`).
- `src/parser.ts`: the side-effect-free `ArgvParser` contract. `src/parsers/*`: node, cac, meow adapters, exported as subpaths.
- Routing, help, version, and number coercion belong to cliff; defaults and value validation belong to the option schema. Adapters only split argv into flags and positionals.

## Commands

- `pnpm test:run` runs unit, parser-contract (`describe.each` over every parser), and `*.test-d.ts` type tests.
- `pnpm typecheck`, `pnpm lint` / `pnpm lint:fix`, `pnpm build`, `pnpm publint`.
- Always run `pnpm typecheck`, `pnpm lint`, and `pnpm test:run` after finishing a task.

## Development Practices

- Any behavior that users observe through a parser must be covered by the parser contract suite in `src/cli.test.ts`, so every adapter is held to it. Document a deliberate adapter divergence with `it.skipIf` and a README note.
- Tests use Valibot schemas wrapped with `toStandardJsonSchema` from `@valibot/to-json-schema`. Do not reimplement schema validation inside cliff.
- Use `errorMessageFrom(error)` from `@moeru/std` instead of manual `error instanceof Error ? error.message : String(error)`.
- Do not add backward-compatibility guards while the package is 0.x.
- Never write to `process.*` or `console.*` outside `src/main.ts`; commands and cliff write through the injected `CliIo`.
- For any investigated bug, reproduce it first with a test. Include `Issue #<number>` in the test name and the report link in a comment above it.
- Before adding a dependency, ask the user. Never pick generalized utility libraries on your own.

## Readability, Naming, and Comments

- File names: kebab-case.
- Prefer names that rely on the module boundary for context instead of repeating package, product, protocol, or transport prefixes inside every symbol. A well-named module should let exported functions use short action-first names; repeat the larger context only when the symbol crosses a boundary where that context is no longer obvious.
- Name functions after the domain operation they perform, not after the implementation layer that happens to contain them. This keeps call sites readable after refactors and avoids names becoming stale when code moves between files.
- Avoid names that encode multiple layers of ownership into one symbol. If a name needs several qualifiers to be understandable, reconsider the module boundary or introduce a clearer local concept.
- Use nouns for resolved domain concepts and verbs for transformations or side effects. When a function derives a policy/configuration from an event or request, name the domain result explicitly so callers understand what decision is being made.
- Prefer classes for runtime/browser APIs and substantial business modules when the class owns state, lifecycle, or a stable domain boundary. Prefer FP for pure transformations and local helpers.
- Use dependency injection only at real external boundaries: database, model runtime, queue, Redis/cache, filesystem, network, clock, environment, and feature gates. Do not introduce `Dependencies`/`Deps` objects for internal functions that only call sibling helpers or forward parameters.
- Comments should reduce reader uncertainty, not increase documentation volume.
- Write comments where a reader would otherwise ask why this case can happen, why this branch is ignored, why this fallback exists, why this order matters, what state changed here, what external side effect just happened, or what protocol/invariant this line is preserving.
- Good comments explain hidden intent, constraints, ownership, invariants, ordering, side effects, protocol shape, or non-obvious fallback behavior.
- Bad comments translate code into English, restate names/types, or exist only to satisfy hover documentation.
- Important implementation comments should live near the confusing line or branch, not only on exported declarations.
- For calculation-heavy code, prefer inline comments near the intermediate values and branches that need explanation. Do not rely only on function-level JSDoc when the hard part is a coordinate system, unit conversion, clamp, rounding rule, aggregation, fallback, or precedence decision.
- Apply this especially to geometry, graphics and shader math, billing or metering, analytics or statistics, UI layout and positioning, ranking or scoring, and normalization code.
- Format longer comments as short paragraphs separated by blank comment lines. Do not compress background, symptom, rejected alternatives, final rationale, and references into one dense block.
- For investigation-heavy comments, prefer this order when useful: source/context, observed failure, why the obvious fix is insufficient, chosen fix, and references/removal condition.
- Do not add broad comments like `// Config`, `// Host`, or `// Update state` unless they explain a non-obvious boundary or transition.
- Add clear, concise comments for utils, math, OS-interaction, algorithm, shared, and architectural functions that explain non-obvious intent, invariants, constraints, or why the code is needed.
- When using a workaround, add a `// NOTICE:` comment explaining why, the root cause, and any source context. If validated via `node_modules` inspection or external sources (e.g., GitHub), include relevant line references and links in code-formatted text.
- When copying, adapting, or deriving code, configuration, constants, schemas, ignore patterns, algorithms, or rules from an external repository, add a nearby `// NOTICE:` comment with a GitHub permalink pinned to the source commit and exact line reference. Use single-line references like `https://github.com/eslint/eslint/blob/833ec10fd702644e94334edd3cd2aa313174a958/.editorconfig#L11` and multi-line references like `https://github.com/eslint/eslint/blob/833ec10fd702644e94334edd3cd2aa313174a958/.editorconfig#L11-L17`. Do not use branch links such as `main` or links without line numbers for traceable source references.
- When moving/refactoring/fixing/updating code, keep still-accurate comments with the code. Remove obsolete comments rather than preserving their history in source; explain notable removals in review notes when needed.
- Avoid stubby/hacky scaffolding; prefer small refactors that leave code cleaner.
- Use markers:
  - `// TODO:` follow-ups
  - `// REVIEW:` concerns/needs another eye
  - `// NOTICE:` magic numbers, hacks, important context, external references/links

## PR / Workflow Tips

- Branch naming `username/feat/short-name`; Conventional Commits (`feat(parsers): ...`); gitmoji is prohibited.
- Summarize changes, how they were tested (commands), and follow-ups.
- Keep `README.md` current: what it does, how to use it, when to use it, when not to use it.
