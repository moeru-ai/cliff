import { createCli, defineCommand, defineFlags } from '@moeru/cliff'

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
    signal.throwIfAborted()
    io.stdout.write(`linting ${args.files.join(', ')} with ${flags.format}\n`)
    return 0
  },
  arguments: [{ description: 'Files to lint', name: 'files', variadic: true }],
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
  action: ({ args, flags, io }) => {
    io.stdout.write(`${args.provider ?? 'all providers'} (${flags.local ? 'project' : 'global'})\n`)
  },
  arguments: [{ description: 'Provider to list', name: 'provider' }],
  description: 'List providers',
  flags: [...sharedFlags, { description: 'Use project scope', flag: '-l, --local' }],
  name: 'ls',
})
const providers = defineCommand({ children: [ls], description: 'Manage providers', name: 'providers' })

// `tool exec --dry eslint --fix src` hands `eslint --fix src` over untouched, as `pnpm exec` does.
const exec = defineCommand({
  action: ({ args, flags, io }) => {
    io.stdout.write(`${flags.dry ? 'would run' : 'running'}: ${args.command.join(' ')}\n`)
  },
  arguments: [{ description: 'Command and its arguments', name: 'command', required: true, variadic: true }],
  description: 'Run a command',
  flags: [{ description: 'Print the command instead of running it', flag: '--dry' }],
  name: 'exec',
  passThrough: true,
})

export const cli = createCli({
  children: [providers, exec, lint],
  description: 'An example tool.',
  name: 'tool',
  version: '1.0.0',
})
