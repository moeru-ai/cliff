# @moeru/cliff

Command tree orchestration for Node.js CLIs. You declare commands, options as [Standard JSON Schema](https://standardschema.dev/json-schema) schemas (Zod 4, ArkType, Valibot, ...), and positional arguments. cliff routes argv, renders help, reports usage errors, and calls your command with an injected `io`. The actual flag parsing is delegated to a pluggable parser: `node:util` `parseArgs` (default), [cac](https://github.com/cacjs/cac), or [meow](https://github.com/sindresorhus/meow).

## Why

cac and meow parse flags well, but nested subcommands, per-command help, exit codes, and testable I/O are left to every project. In practice each CLI grows its own layer on top: hand-written dispatch, help callbacks, hard-coded lists of value-taking flags, `console.log` interception. cliff is that layer, written once.

## Usage

```ts
import { createCli, defineCommand, defineGlobalOptions, runMain } from '@moeru/cliff'

import * as v from 'valibot'

const globals = defineGlobalOptions({
  config: { description: 'Config file', placeholder: 'path', schema: s(v.optional(v.string())), short: 'c' },
})

const lint = globals.defineCommand({
  args: '[...files]',
  default: true, // `tool src` runs `tool lint src`
  description: 'Lint files',
  name: 'lint',
  options: {
    format: { description: 'Reporter', schema: s(v.optional(v.picklist(['stylish', 'json']), 'stylish')) },
    retries: { schema: s(v.optional(v.pipe(v.number(), v.integer(), v.minValue(0), v.description('Retry count')))) },
    rule: { description: 'Only run matching rules', schema: s(v.optional(v.array(v.string()), [])) },
  },
  run: async ({ args, globals, io, options, signal }) => {
    // args.files: string[], options.format: 'stylish' | 'json', options.retries: number | undefined
    io.stdout.write(`${args.files.join(', ')}\n`)
    return 0
  },
})

const ls = defineCommand({ args: '[provider]', description: 'List providers', name: 'ls', run: () => {} })
const providers = defineCommand({ commands: [ls], description: 'Manage providers', name: 'providers' })

export const cli = createCli({
  commands: [providers, lint],
  description: 'An example tool.',
  name: 'tool',
  options: globals.options,
  version: '1.0.0',
})

// bin entry
await runMain(cli)
```

To use another parser, pass it to `createCli`:

```ts
import { cacParser } from '@moeru/cliff/parsers/cac'

createCli({ /* ... */ parser: cacParser })
```

### Testing

`cli.run(argv, io)` touches no `process` state. It resolves to the exit code, so a test can assert on the captured output:

```ts
const io = { cwd: '/project', stderr: { write: vi.fn() }, stdout: { write: vi.fn() } }

expect(await cli.run(['providers', 'ls', 'openrouter'], io)).toBe(0)
```

`runMain(cli)` is the only part that binds to the process: it passes `process.argv.slice(2)` and the real stdio, sets `process.exitCode`, aborts `context.signal` on the first SIGINT/SIGTERM, and prints errors thrown by a command as `<name>: <message>` with exit code 1.

## Option schemas

Each option is `{ schema, description?, short?, placeholder? }`. The schema must implement both [Standard Schema](https://standardschema.dev) and [Standard JSON Schema](https://standardschema.dev/json-schema):

| Library | How |
|---|---|
| Zod 4, ArkType | Native. Pass the schema as is. |
| Valibot | Wrap with `toStandardJsonSchema` from `@valibot/to-json-schema`. |

cliff uses the schema twice:

1. **Argv shape.** `~standard.jsonSchema.input({ target: 'draft-07' })` describes what argv must provide. From it, cliff reads whether the flag is a boolean, number, or string, whether it is repeatable (`array`), its choices (`enum` or a union of literals), its default, and its description. The conversion is synchronous, so `createCli` reports a bad schema with a `DefinitionError` at once.
2. **Validation.** Parsed values go through `~standard.validate`. The output (with defaults and transforms applied) is what `run` receives, and its type is inferred from the schema. A failure is a usage error: `error: option --retries: Invalid integer: Received 1.5`.

Because the shape comes from the input side, transforms work: `s(v.pipe(v.string(), v.transform(Number)))` is parsed as a string flag and reaches `run` as a number.

## Concepts

| Concept | Behavior |
|---|---|
| Option keys | camelCase keys map to kebab-case flags: `timeoutMs` -> `--timeout-ms`. |
| Option values | An absent flag reaches the schema as `undefined`, so the schema's default applies. A boolean whose schema defaults to `true` is shown as `--no-<flag>`. |
| Arguments | `<a>` is required, `[a]` optional, `<...a>` one or more, `[...a]` zero or more. Extra positionals are a usage error. |
| Inheritance | Options on the CLI root, or on a command that has `commands`, are accepted by every descendant and reach it as `context.globals`. Redeclaring an inherited key, flag, or short flag is a `DefinitionError`. |
| Routing | The first positional that names a child selects it. Otherwise, a `default: true` child receives it. Flags may appear before or after command names. |
| Built-ins | `-h`/`--help` prints help for the selected command. `-v`/`--version` is enabled by `version`. Both are reserved. |
| Exit codes | The value returned by `run` (nothing means 0). Help and version exit 0. Usage errors, including a `UsageError` thrown by a command, exit 2. Other errors are rethrown. |
| `--` | Later tokens are not parsed. They are bound to positionals and also exposed as `context.rest`. |

## Parsers

cliff routes, validates, and normalizes. A parser only splits one command's argv into flags and positionals. Before calling a parser, cliff rewrites known value flags to `--flag=value` and expands short clusters. This removes the main differences between libraries: negative numbers, `-` as a value, and `-abc` clusters.

| Parser | Import | Dependency | Notes |
|---|---|---|---|
| node | `@moeru/cliff/parsers/node` (default) | none | `util.parseArgs`. Needs Node 22.4+ for `allowNegative`. |
| cac | `@moeru/cliff/parsers/cac` | `cac` peer | mri casts numeric-looking string values, so `--name 007` arrives as `"7"`. |
| meow | `@moeru/cliff/parsers/meow` | `meow` peer | `process.exit` paths and the `process.title` side effect are avoided. |

An unknown flag only reaches a parser when the command sets `allowUnknownOptions`. In that case, parsers may disagree on whether `--unknown value` consumes `value`.

## When to use

- A Node.js CLI with nested subcommands, shared global options, and per-command help.
- Migrating a cac or meow CLI step by step: keep the parser you already use and replace the hand-written routing around it.
- Tests that need to run the full CLI in-process and assert on output and exit codes.

## When not to use

- Single-flag scripts. `util.parseArgs` alone is enough.
- Options shaped as objects or nested records. Argv is flat, so cliff rejects schemas that are not a boolean, number, string, or array of those.
- Interactive prompts, spinners, or TUI layout. cliff only ends where a command's `run` begins.
- Shell completion generation or plugin auto-discovery. These are not implemented yet.

## Development

```sh
pnpm install
pnpm test:run   # unit, parser contract, and type tests
pnpm typecheck
pnpm lint
pnpm build
```
