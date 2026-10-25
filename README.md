# @moeru/cliff

Command tree orchestration for Node.js CLIs. You declare commands with flags written the way help shows them (`-c, --config <path>`), and cliff infers their types from those strings. cliff routes argv, renders help, reports usage errors, and calls your action with an injected `io`. Flags can carry any [Standard Schema](https://standardschema.dev) (Valibot, Zod, ArkType, ...) for validation and transforms. The actual flag parsing is delegated to a pluggable parser: `node:util` `parseArgs` (default), [cac](https://github.com/cacjs/cac), or [meow](https://github.com/sindresorhus/meow).

## Why

cac and meow parse flags well, but nested subcommands, per-command help, exit codes, and testable I/O are left to every project. In practice each CLI grows its own layer on top: hand-written dispatch, help callbacks, hard-coded lists of value-taking flags, `console.log` interception. cliff is that layer, written once.

## Usage

```ts
import { createCli, defineCommand, defineFlags, runMain } from '@moeru/cliff'

import * as v from 'valibot'

// A shared set is just an array; spread it into every command that accepts it.
const sharedFlags = defineFlags([
  { description: 'Config file', flag: '-c, --config <path>' },
  { description: 'Disable the cache', flag: '--no-cache' },
])

const lint = defineCommand({
  action: async ({ args, flags, io, signal }) => {
    // args.files: string[]
    // flags.config: string | undefined, flags.cache: boolean, flags.dirty: boolean
    // flags.format: 'stylish' | 'json', flags.rule: string[], flags.retries: number | undefined
    io.stdout.write(`${args.files.join(', ')}\n`)
    return 0
  },
  arguments: '[...files]',
  default: true, // `tool src` runs `tool lint src`
  description: 'Lint files',
  flags: [
    ...sharedFlags,
    { description: 'Lint changed files only', flag: '--dirty' },
    { default: 'stylish', description: 'Reporter', flag: '-f, --format <stylish|json>' },
    { description: 'Only run matching rules', flag: '--rule <pattern...>' },
    { description: 'Retry count', flag: '--retries <n>', schema: v.optional(v.pipe(v.string(), v.toNumber(), v.integer())) },
  ],
  name: 'lint',
})

const ls = defineCommand({
  action: ({ args, flags }) => {},
  arguments: '[provider]',
  description: 'List providers',
  flags: [...sharedFlags, { description: 'Use project scope', flag: '-l, --local' }],
  name: 'ls',
})
const providers = defineCommand({ children: [ls], description: 'Manage providers', name: 'providers' })

export const cli = createCli({
  children: [providers, lint],
  description: 'An example tool.',
  name: 'tool',
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

`cli.run(argv, io)` touches no `process` state and resolves to the exit code. `io` only needs `stdout` and `stderr`; `createMemoryIo` from `@moeru/cliff/testing` captures both:

```ts
import { createMemoryIo } from '@moeru/cliff/testing'

const io = createMemoryIo({ cwd: '/project' })

expect(await cli.run(['providers', 'ls', 'openrouter'], io)).toBe(0)
expect(io.stdout.text()).toContain('openrouter')
```

`runMain(cli)` is the only part that binds to the process. It passes `process.argv.slice(2)` and the real stdio, and sets `process.exitCode`. On the first SIGINT/SIGTERM it aborts `context.signal`. If an action throws, it prints `<name>: <message>` and exits with code 1.

## Flags

The flag spelling decides how the flag is parsed and what type the action receives:

| Spelling | Absent | Value type |
|---|---|---|
| `--dirty` | `false` | `boolean` |
| `--no-cache` | `true` | `boolean`, keyed `cache` |
| `-c, --config <path>` | `undefined` | `string \| undefined` |
| `--format <stylish\|json>` | `undefined` | `'stylish' \| 'json' \| undefined`, other values are a usage error |
| `--rule <pattern...>` | `[]` | `string[]`, repeatable |

Keys are the camelCase long name: `--timeout-ms` becomes `timeoutMs`. `default` replaces the absent value and removes `undefined` from the type.

`schema` is any Standard Schema. It receives the parsed value, or the default when the flag is absent. Its output is what the action sees, and the action's type comes from it, as in `v.pipe(v.string(), v.toNumber())`. A failure is a usage error: `error: flag --retries: Invalid integer: Received 1.5`.

Flags are not inherited. Each command accepts exactly the flags it declares, so shared flags are spread in with `defineFlags`. A shared flag may still be typed before the command name (`tool -c x providers ls`).

## Concepts

| Concept | Behavior |
|---|---|
| Arguments | `<a>` is required, `[a]` optional, `<...a>` one or more, `[...a]` zero or more. Extra positionals are a usage error. |
| Routing | The first positional that names a child selects it. Otherwise, a `default: true` child receives it. |
| Built-ins | `-h`/`--help` prints help for the selected command. `-v`/`--version` is enabled by `version`. Both are reserved. |
| Exit codes | The value returned by `action` (nothing means 0). Help and version exit 0. Usage errors, including a `UsageError` thrown by an action, exit 2. Other errors are rethrown. |
| `--` | Later tokens are not parsed. They are bound to positionals and also exposed as `context.rest`. |
| Definition errors | Malformed spellings, duplicate keys or short flags, reserved names, and ambiguous trees throw `DefinitionError` from `createCli`. |

## Parsers

cliff routes, validates, and normalizes. A parser only splits one command's argv into flags and positionals. Before calling a parser, cliff rewrites known value flags to `--flag=value` and expands short clusters. This removes the main differences between libraries: negative numbers, `-` as a value, and `-abc` clusters.

| Parser | Import | Dependency | Notes |
|---|---|---|---|
| node | `@moeru/cliff/parsers/node` (default) | none | `util.parseArgs`. Needs Node 22.4+ for `allowNegative`. |
| cac | `@moeru/cliff/parsers/cac` | `cac` peer | mri casts numeric-looking string values, so `--name 007` arrives as `"7"`. |
| meow | `@moeru/cliff/parsers/meow` | `meow` peer | `process.exit` paths and the `process.title` side effect are avoided. |

An unknown flag only reaches a parser when the command sets `allowUnknownFlags`. In that case, parsers may disagree on whether `--unknown value` consumes `value`.

## When to use

- A Node.js CLI with nested subcommands, shared flags, and per-command help.
- Migrating a cac or meow CLI step by step: keep the parser you already use and replace the hand-written routing around it.
- Tests that need to run the full CLI in-process and assert on output and exit codes.

## When not to use

- Single-flag scripts. `util.parseArgs` alone is enough.
- Flags with optional values (`--color [when]`) or nested dot options (`--a.b`). Neither is supported yet.
- Interactive prompts, spinners, or TUI layout. cliff only ends where a command's `action` begins.
- Shell completion generation or plugin auto-discovery. These are not implemented yet.

## Development

```sh
pnpm install
pnpm test:run   # unit, parser contract, and type tests
pnpm typecheck
pnpm lint
pnpm build
```
