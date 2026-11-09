import type { CliDefinition } from './cli'
import type { CommandContext, CommandResult } from './command'
import type { UsageIssue } from './errors'
import type { Help } from './help'
import type { ArgvParser } from './parser'
import type { UsageErrorReport } from './usage-error'

import { describe, expect, it, vi } from 'vitest'

import * as v from 'valibot'

import { createCli } from './cli'
import { defineCommand } from './command'
import { DefinitionError, UsageError } from './errors'
import { defineFlags } from './flags'
import { renderHelp } from './help'
import { cacParser } from './parsers/cac'
import { meowParser } from './parsers/meow'
import { nodeParser } from './parsers/node'
import { createMemoryIo } from './testing'
import { renderUsageError } from './usage-error'

type Run = (context: CommandContext) => CommandResult | Promise<CommandResult>

const sharedFlags = defineFlags([
  { description: 'Config file', flag: '-c, --config <path>' },
  { description: 'Disable the cache', flag: '--no-cache' },
])

type Renderers = Pick<CliDefinition, 'renderHelp' | 'renderUsageError'>

function createSampleCli(parser: ArgvParser, run: Run, renderers: Renderers = {}) {
  const lint = defineCommand({
    action: context => run(context),
    arguments: [{ description: 'Files to lint', name: 'files', variadic: true }],
    default: true,
    description: 'Lint files',
    flags: [
      ...sharedFlags,
      { description: 'Lint changed files only', flag: '--dirty' },
      { default: 'stylish', description: 'Reporter', flag: '-f, --format <stylish|json>' },
      { description: 'Run name', flag: '--name <name>' },
      { description: 'Retry count', flag: '--retries <n>', schema: v.optional(v.pipe(v.string(), v.toNumber(), v.integer(), v.minValue(0))) },
      { description: 'Rule filter', flag: '--rule <pattern...>' },
      { description: 'Timeout', flag: '--timeout-ms <ms>', schema: v.optional(v.pipe(v.string(), v.toNumber())) },
    ],
    name: 'lint',
  })
  const ls = defineCommand({
    action: context => run(context),
    alias: ['list'],
    arguments: [{ description: 'Provider name', name: 'provider' }],
    description: 'List providers',
    flags: [
      ...sharedFlags,
      { description: 'Use project scope', flag: '-l, --local' },
    ],
    name: 'ls',
  })
  const providers = defineCommand({ children: [ls], description: 'Manage providers', name: 'providers' })
  const config = defineCommand({ children: [providers], description: 'Manage configuration', name: 'config' })

  return createCli({
    children: [config, lint],
    description: 'AI-assisted linting.',
    name: 'alint',
    parser,
    version: '1.2.3',
    ...renderers,
  })
}

function createServeCli(parser: ArgvParser, renderers: Renderers = {}) {
  return createCli({
    action: () => 0,
    arguments: [
      { description: 'Port', name: 'port', required: true, schema: v.pipe(v.string(), v.toNumber(), v.integer()) },
      { default: 'dev', description: 'Mode', name: 'mode', schema: v.picklist(['dev', 'prod']) },
    ],
    description: '',
    name: 'serve',
    parser,
    ...renderers,
  })
}

describe.each([nodeParser, cacParser, meowParser])('parser contract: $name', (parser) => {
  async function invoke(argv: string[]) {
    const run = vi.fn<Run>(() => 0)
    const io = createMemoryIo()
    const exitCode = await createSampleCli(parser, run).execute(argv, io)

    return { context: run.mock.calls[0]?.[0], exitCode, io, run }
  }

  it('routes bare positionals to the default command with defaults applied', async () => {
    const { context, exitCode } = await invoke(['src', 'test'])

    expect(exitCode).toBe(0)
    expect(context?.path).toEqual(['lint'])
    expect(context?.args).toEqual({ files: ['src', 'test'] })
    expect(context?.flags).toEqual({ cache: true, config: undefined, dirty: false, format: 'stylish', name: undefined, retries: undefined, rule: [], timeoutMs: undefined })
  })

  it('runs the default command when argv is empty', async () => {
    const { context } = await invoke([])

    expect(context?.path).toEqual(['lint'])
    expect(context?.args).toEqual({ files: [] })
  })

  it('parses long, short, inline, repeated, and number flags', async () => {
    const { context } = await invoke(['lint', '--dirty', '-f', 'json', '--rule', 'a', '--rule=b', '--timeout-ms', '500', 'src'])

    expect(context?.args).toEqual({ files: ['src'] })
    expect(context?.flags).toEqual({ cache: true, config: undefined, dirty: true, format: 'json', name: undefined, retries: undefined, rule: ['a', 'b'], timeoutMs: 500 })
  })

  it('keeps negative numbers as values', async () => {
    const { context } = await invoke(['--timeout-ms', '-5'])

    expect(context?.flags.timeoutMs).toBe(-5)
  })

  it('keeps the last value of a repeated single-value flag', async () => {
    const { context } = await invoke(['-f', 'json', '-f', 'stylish'])

    expect(context?.flags.format).toBe('stylish')
  })

  it('routes nested commands through aliases with shared flags before the command name', async () => {
    const { context } = await invoke(['-c', 'alint.config.ts', 'config', 'providers', 'list', 'openrouter', '-l'])

    expect(context?.path).toEqual(['config', 'providers', 'ls'])
    expect(context?.args).toEqual({ provider: 'openrouter' })
    expect(context?.flags).toEqual({ cache: true, config: 'alint.config.ts', local: true })
  })

  it('turns a --no- flag off', async () => {
    const { context } = await invoke(['--no-cache', 'src'])

    expect(context?.flags.cache).toBe(false)
  })

  it('accepts a default command flag before any positional', async () => {
    const { context } = await invoke(['--dirty'])

    expect(context?.path).toEqual(['lint'])
    expect(context?.flags.dirty).toBe(true)
  })

  it('transforms and validates arguments through their schema', async () => {
    const run = vi.fn<Run>()
    const io = createMemoryIo()
    const cli = createCli({
      action: run,
      arguments: [
        { description: 'Port', name: 'port', required: true, schema: v.pipe(v.string(), v.toNumber(), v.integer()) },
        { default: 'dev', description: 'Mode', name: 'mode', schema: v.picklist(['dev', 'prod']) },
      ],
      description: '',
      name: 'serve',
      parser,
    })

    expect(await cli.execute(['8080'], createMemoryIo())).toBe(0)
    expect(run.mock.calls[0]?.[0].args).toEqual({ mode: 'dev', port: 8080 })

    expect(await cli.execute(['8080', 'staging'], io)).toBe(2)
    expect(io.stderr.text().split('\n')[0]).toBe('error: argument [mode]: Invalid type: Expected ("dev" | "prod") but received "staging"')
  })

  it('passes everything from the first positional of a passThrough command through', async () => {
    const run = vi.fn<Run>()
    const cli = createCli({
      children: [defineCommand({
        action: run,
        arguments: [{ description: 'Command to run', name: 'command', required: true, variadic: true }],
        description: 'Run a command',
        flags: [{ description: 'Dry run', flag: '--dry' }],
        name: 'exec',
        passThrough: true,
      })],
      description: '',
      name: 'tool',
      parser,
    })

    expect(await cli.execute(['exec', '--dry', 'eslint', '--fix', '-c', 'x', 'src', '--dry', '--help', '--', 'y'], createMemoryIo())).toBe(0)

    const passed = ['eslint', '--fix', '-c', 'x', 'src', '--dry', '--help', '--', 'y']

    expect(run.mock.calls[0]?.[0].flags).toEqual({ dry: true })
    expect(run.mock.calls[0]?.[0].args).toEqual({ command: passed })
    expect(run.mock.calls[0]?.[0].rest).toEqual(passed)
  })

  it('binds tokens after -- as positionals without parsing them', async () => {
    const { context } = await invoke(['--', '--weird', 'config'])

    expect(context?.path).toEqual(['lint'])
    expect(context?.args).toEqual({ files: ['--weird', 'config'] })
    expect(context?.rest).toEqual(['--weird', 'config'])
  })

  it.skipIf(parser === cacParser)('keeps numeric-looking string values verbatim', async () => {
    const { context } = await invoke(['--name', '007'])

    expect(context?.flags.name).toBe('007')
  })

  it.each([
    [['-f', 'xml'], 'error: flag --format must be one of stylish, json, received "xml"'],
    [['--retries', '1.5'], 'error: flag --retries: Invalid integer: Received 1.5'],
    [['--nope'], 'error: unknown flag --nope'],
    [['config', 'providers', 'ls', '--dirty'], 'error: unknown flag --dirty'],
    [['--config'], 'error: flag --config requires a value'],
    [['config', 'providers', 'ls', 'a', 'b'], 'error: unexpected argument "b"'],
  ])('reports %j as a usage error', async (argv, message) => {
    const { exitCode, io, run } = await invoke(argv)

    expect(exitCode).toBe(2)
    expect(io.stderr.text().split('\n')[0]).toBe(message)
    expect(io.stderr.text()).toContain('--help` for usage.')
    expect(run).not.toHaveBeenCalled()
  })

  const lsCommand = { aliases: ['list'], argumentsLabel: '[provider]', default: false, description: 'List providers', hasChildren: false, name: 'ls' }

  it.each<[string, (parser: ArgvParser, renderers: Renderers) => ReturnType<typeof createCli>, string[], UsageErrorReport]>([
    ['flag-requires-value (long)', (parser, renderers) => createSampleCli(parser, () => 0, renderers), ['--config'], {
      // Routing has not finished when a value is missing, so the hint points at the root.
      command: 'alint',
      issue: { code: 'flag-requires-value', flag: '--config' },
      message: 'flag --config requires a value',
    }],
    ['flag-requires-value (short)', (parser, renderers) => createSampleCli(parser, () => 0, renderers), ['-c', '--dirty'], {
      // Routing has not finished when a value is missing, so the hint points at the root.
      command: 'alint',
      issue: { code: 'flag-requires-value', flag: '-c' },
      message: 'flag -c requires a value',
    }],
    ['invalid-choice', (parser, renderers) => createSampleCli(parser, () => 0, renderers), ['-f', 'xml'], {
      command: 'alint lint',
      issue: { choices: ['stylish', 'json'], code: 'invalid-choice', flag: '--format', received: 'xml' },
      message: 'flag --format must be one of stylish, json, received "xml"',
    }],
    ['invalid-value (flag)', (parser, renderers) => createSampleCli(parser, () => 0, renderers), ['--retries', '1.5'], {
      command: 'alint lint',
      issue: { code: 'invalid-value', label: '--retries', messages: ['Invalid integer: Received 1.5'], target: 'flag' },
      message: 'flag --retries: Invalid integer: Received 1.5',
    }],
    ['invalid-value (argument)', createServeCli, ['8080', 'staging'], {
      command: 'serve',
      issue: { code: 'invalid-value', label: '[mode]', messages: ['Invalid type: Expected ("dev" | "prod") but received "staging"'], target: 'argument' },
      message: 'argument [mode]: Invalid type: Expected ("dev" | "prod") but received "staging"',
    }],
    ['missing-argument', createServeCli, [], {
      command: 'serve',
      issue: { argument: '<port>', code: 'missing-argument' },
      message: 'missing required argument <port>',
    }],
    ['missing-command', (parser, renderers) => createSampleCli(parser, () => 0, renderers), ['config', 'providers'], {
      command: 'alint config providers',
      commands: [lsCommand],
      issue: { code: 'missing-command', command: 'alint config providers' },
      message: 'missing command for "alint config providers"',
    }],
    ['unexpected-argument', (parser, renderers) => createSampleCli(parser, () => 0, renderers), ['config', 'providers', 'ls', 'a', 'b'], {
      command: 'alint config providers ls',
      issue: { code: 'unexpected-argument', received: 'b' },
      message: 'unexpected argument "b"',
    }],
    ['unknown-command', (parser, renderers) => createSampleCli(parser, () => 0, renderers), ['config', 'providers', 'nope'], {
      command: 'alint config providers',
      commands: [lsCommand],
      issue: { code: 'unknown-command', command: 'alint config providers', received: 'nope' },
      message: 'unknown command "nope" for "alint config providers"',
    }],
    ['unknown-flag (long)', (parser, renderers) => createSampleCli(parser, () => 0, renderers), ['config', 'providers', 'ls', '--dirty'], {
      command: 'alint config providers ls',
      issue: { code: 'unknown-flag', flag: '--dirty' },
      message: 'unknown flag --dirty',
    }],
    ['unknown-flag (short)', (parser, renderers) => createSampleCli(parser, () => 0, renderers), ['-x'], {
      command: 'alint lint',
      issue: { code: 'unknown-flag', flag: '-x' },
      message: 'unknown flag -x',
    }],
  ])('passes the %s issue to renderUsageError', async (_, create, argv, expected) => {
    const renderUsageError = vi.fn((report: UsageErrorReport) => `custom: ${report.issue?.code}\n`)
    const io = createMemoryIo()

    expect(await create(parser, { renderUsageError }).execute(argv, io)).toBe(2)
    expect(renderUsageError).toHaveBeenCalledOnce()
    expect(renderUsageError.mock.calls[0]![0]).toStrictEqual(expected)
    expect(io.stderr.text()).toBe(`custom: ${expected.issue!.code}\n`)
    expect(io.stdout.text()).toBe('')
  })
})

describe('createCli', () => {
  it('reports an unknown subcommand with the available commands', async () => {
    const io = createMemoryIo()
    const exitCode = await createSampleCli(nodeParser, () => 0).execute(['config', 'nope'], io)

    expect(exitCode).toBe(2)
    expect(io.stderr.text()).toBe([
      'error: unknown command "nope" for "alint config"',
      '',
      'Commands',
      '  providers <command>  Manage providers',
      '',
      'Run `alint config --help` for usage.',
      '',
    ].join('\n'))
  })

  it('reports a missing subcommand', async () => {
    const io = createMemoryIo()
    const exitCode = await createSampleCli(nodeParser, () => 0).execute(['config'], io)

    expect(exitCode).toBe(2)
    expect(io.stderr.text().split('\n')[0]).toBe('error: missing command for "alint config"')
  })

  it('prints only the version string', async () => {
    const io = createMemoryIo()

    expect(await createSampleCli(nodeParser, () => 0).execute(['-v'], io)).toBe(0)
    expect(io.stdout.text()).toBe('1.2.3\n')
  })

  it('renders root help instead of running the default command', async () => {
    const io = createMemoryIo()
    const run = vi.fn<Run>()

    expect(await createSampleCli(nodeParser, run).execute(['--help'], io)).toBe(0)
    expect(run).not.toHaveBeenCalled()
    expect(io.stdout.text()).toMatchInlineSnapshot(`
      "AI-assisted linting.

      Usage
        $ alint <command> [flags]

      Commands
        config <command>  Manage configuration
        lint [...files]   Lint files (default)

      Flags
        -h, --help     Show help
        -v, --version  Show version
      "
    `)
  })

  it('renders leaf help with flags as written', async () => {
    const io = createMemoryIo()

    await createSampleCli(nodeParser, () => 0).execute(['config', 'providers', 'ls', '-h'], io)

    expect(io.stdout.text()).toMatchInlineSnapshot(`
      "List providers

      Usage
        $ alint config providers ls [provider] [flags]

      Arguments
        [provider]  Provider name

      Flags
        -c, --config <path>  Config file
            --no-cache       Disable the cache
        -l, --local          Use project scope
        -h, --help           Show help
        -v, --version        Show version
      "
    `)
  })

  it('lists arguments with their defaults in help', async () => {
    const io = createMemoryIo()
    const cli = createCli({
      action: () => 0,
      arguments: [
        { description: 'Port to listen on', name: 'port', required: true },
        { default: 'dev', description: 'Run mode', name: 'mode' },
        { description: 'Files to serve', name: 'files', variadic: true },
      ],
      description: 'Serve files',
      name: 'serve',
    })

    await cli.execute(['--help'], io)

    expect(io.stdout.text()).toMatchInlineSnapshot(`
      "Serve files

      Usage
        $ serve <port> [mode] [...files] [flags]

      Arguments
        <port>      Port to listen on
        [mode]      Run mode (default: dev)
        [...files]  Files to serve

      Flags
        -h, --help  Show help
      "
    `)
  })

  it('puts flags before the arguments in the usage of a passThrough command', async () => {
    const io = createMemoryIo()
    const cli = createCli({
      action: () => 0,
      arguments: [{ description: 'Command to run', name: 'command', required: true, variadic: true }],
      description: 'Run a command',
      name: 'exec',
      passThrough: true,
    })

    await cli.execute(['-h'], io)

    expect(io.stdout.text()).toContain('Usage\n  $ exec [flags] <...command>\n')
  })

  it('notes defaults and repeatable flags in help', async () => {
    const io = createMemoryIo()

    await createSampleCli(nodeParser, () => 0).execute(['lint', '--help'], io)

    expect(io.stdout.text()).toContain('  -f, --format <stylish|json>  Reporter (default: stylish)\n')
    expect(io.stdout.text()).toContain('      --rule <pattern...>      Rule filter (repeatable)\n')
  })

  it('returns the exit code of the command', async () => {
    const exitCode = await createSampleCli(nodeParser, () => 3).execute(['src'], createMemoryIo())

    expect(exitCode).toBe(3)
  })

  it('reports usage errors thrown by a command', async () => {
    const io = createMemoryIo()
    const exitCode = await createSampleCli(nodeParser, () => {
      throw new UsageError('--dirty does not accept files')
    }).execute(['src'], io)

    expect(exitCode).toBe(2)
    expect(io.stderr.text()).toBe('error: --dirty does not accept files\n\nRun `alint lint --help` for usage.\n')
  })

  it('rethrows other command errors', async () => {
    const cli = createSampleCli(nodeParser, () => {
      throw new Error('boom')
    })

    await expect(cli.execute(['src'], createMemoryIo())).rejects.toThrow('boom')
  })

  it('accepts undeclared flags when the command allows them', async () => {
    const run = vi.fn<Run>()
    const cli = createCli({
      action: run,
      allowUnknownFlags: true,
      arguments: [{ description: '', name: 'files', variadic: true }],
      description: 'Single command CLI',
      name: 'tool',
    })

    expect(await cli.execute(['--extra', 'a'], createMemoryIo())).toBe(0)
    expect(run.mock.calls[0]?.[0].args).toEqual({ files: ['a'] })
  })
})

describe('createCli definition checks', () => {
  const leaf = (name: string, extra: object = {}) => defineCommand({ action: () => 0, description: name, name, ...extra })

  it.each([
    ['duplicate names', [leaf('a'), leaf('b', { alias: ['a'] })], 'more than one subcommand named "a"'],
    ['two defaults', [leaf('a', { default: true }), leaf('b', { default: true })], 'more than one default subcommand'],
    ['reserved short flag', [leaf('a', { flags: [{ description: '', flag: '-h, --hidden' }] })], 'reserved for help or version'],
    ['a shared set spread twice', [leaf('a', { flags: [...sharedFlags, ...sharedFlags] })], 'flag "-c, --config <path>" of command "a" clashes with flag "-c, --config <path>"'],
    ['both --cache and --no-cache', [leaf('a', { flags: [{ description: '', flag: '--cache' }, { description: '', flag: '--no-cache' }] })], 'clashes with flag "--cache"'],
    ['a malformed spelling', [leaf('a', { flags: [{ description: '', flag: '--config=<path>' }] })], 'is not a valid spelling'],
    ['a negated flag with a value', [leaf('a', { flags: [{ description: '', flag: '--no-cache <dir>' }] })], 'is negated, so it cannot take a value'],
    ['a bad argument', [leaf('a', { arguments: [{ description: '', name: 'files', variadic: true }, { description: '', name: 'out' }] })], 'must be last'],
    ['passThrough with children', [defineCommand({ action: () => 0, arguments: [{ description: '', name: 'x', variadic: true }], children: [leaf('b')], description: '', name: 'a', passThrough: true })], 'command "a" passes arguments through, so it cannot have subcommands'],
    ['passThrough without a variadic argument', [leaf('a', { arguments: [{ description: '', name: 'x' }], passThrough: true })], 'command "a" passes arguments through, so its last argument must be variadic'],
    ['arguments on a command without an action', [defineCommand({ arguments: [{ description: '', name: 'x' }], children: [leaf('b')], description: '', name: 'a' })], 'declares arguments but no action'],
    ['a leaf without an action', [defineCommand({ description: '', name: 'a' })], 'command "a" has neither an action nor children'],
  ])('rejects %s', (_, children, message) => {
    expect(() => createCli({ children, description: '', name: 'tool', version: '1.0.0' })).toThrow(DefinitionError)
    expect(() => createCli({ children, description: '', name: 'tool', version: '1.0.0' })).toThrow(message)
  })
})

describe('abort signal', () => {
  it('passes the abort signal to the command', async () => {
    const run = vi.fn<Run>()
    const controller = new AbortController()

    await createSampleCli(nodeParser, run).execute(['src'], createMemoryIo(), { signal: controller.signal })

    expect(run.mock.calls[0]?.[0].signal).toBe(controller.signal)
  })

  it('gives the command a signal when the caller passes none', async () => {
    const run = vi.fn<Run>()

    await createSampleCli(nodeParser, run).execute(['src'], createMemoryIo())

    expect(run.mock.calls[0]?.[0].signal).toBeInstanceOf(AbortSignal)
    expect(run.mock.calls[0]?.[0].signal.aborted).toBe(false)
  })

  it('rejects with the abort reason before running an aborted invocation', async () => {
    const run = vi.fn<Run>()
    const io = createMemoryIo()
    const reason = new Error('cancelled')

    await expect(createSampleCli(nodeParser, run).execute(['src'], io, { signal: AbortSignal.abort(reason) })).rejects.toBe(reason)
    expect(run).not.toHaveBeenCalled()
    expect(io.stdout.text()).toBe('')
    expect(io.stderr.text()).toBe('')
  })

  it('does not run the command when aborted during flag validation', async () => {
    const run = vi.fn<Run>()
    const controller = new AbortController()
    const reason = new Error('cancelled')
    const cli = createCli({
      action: run,
      description: '',
      flags: [{
        default: 'a',
        description: 'Name',
        flag: '--name <name>',
        schema: v.pipeAsync(v.string(), v.checkAsync(async () => {
          controller.abort(reason)
          return true
        })),
      }],
      name: 'tool',
    })

    await expect(cli.execute([], createMemoryIo(), { signal: controller.signal })).rejects.toBe(reason)
    expect(run).not.toHaveBeenCalled()
  })

  it('does not run the command when aborted during argument validation', async () => {
    const run = vi.fn<Run>()
    const controller = new AbortController()
    const reason = new Error('cancelled')
    const cli = createCli({
      action: run,
      arguments: [{
        description: 'Name',
        name: 'name',
        required: true,
        schema: v.pipeAsync(v.string(), v.checkAsync(async () => {
          controller.abort(reason)
          return true
        })),
      }],
      description: '',
      name: 'tool',
    })

    await expect(cli.execute(['a'], createMemoryIo(), { signal: controller.signal })).rejects.toBe(reason)
    expect(run).not.toHaveBeenCalled()
  })
})

describe('flag schemas', () => {
  it('passes the default through the schema', async () => {
    const run = vi.fn<Run>()
    const cli = createCli({
      action: run,
      description: '',
      flags: [{ default: '8080', description: 'Port', flag: '--port <port>', schema: v.pipe(v.string(), v.toNumber()) }],
      name: 'serve',
    })

    await cli.execute([], createMemoryIo())

    expect(run.mock.calls[0]?.[0].flags).toEqual({ port: 8080 })
  })

  it('validates every value of a repeatable flag', async () => {
    const io = createMemoryIo()
    const cli = createCli({
      action: () => 0,
      description: '',
      flags: [{ description: 'Ports', flag: '--port <port...>', schema: v.array(v.pipe(v.string(), v.toNumber(), v.integer())) }],
      name: 'serve',
    })

    expect(await cli.execute(['--port', '1', '--port', '2.5'], io)).toBe(2)
    expect(io.stderr.text().split('\n')[0]).toBe('error: flag --port: Invalid integer: Received 2.5')
  })
})

describe('render hooks', () => {
  async function captureHelp(argv: string[], create: (renderers: Renderers) => ReturnType<typeof createCli> = renderers => createSampleCli(nodeParser, () => 0, renderers)) {
    const renderHelp = vi.fn((_: Help) => 'custom help\n')
    const io = createMemoryIo()
    const exitCode = await create({ renderHelp }).execute(argv, io)

    expect(exitCode).toBe(0)
    expect(renderHelp).toHaveBeenCalledOnce()
    expect(io.stdout.text()).toBe('custom help\n')
    expect(io.stderr.text()).toBe('')

    return renderHelp.mock.calls[0]![0]
  }

  const helpFlag = { builtin: 'help', label: '-h, --help', long: 'help', short: 'h' } as const
  const versionFlag = { builtin: 'version', label: '-v, --version', long: 'version', short: 'v' } as const
  const configFlag = { choices: undefined, default: undefined, description: 'Config file', label: '-c, --config <path>', long: 'config', repeatable: false, short: 'c' }
  const cacheFlag = { choices: undefined, default: undefined, description: 'Disable the cache', label: '--no-cache', long: 'cache', repeatable: false, short: undefined }

  it('passes the root help with its children and the version flag', async () => {
    expect(await captureHelp(['--help'])).toStrictEqual({
      arguments: [],
      command: 'alint',
      commands: [
        { aliases: [], argumentsLabel: '', default: false, description: 'Manage configuration', hasChildren: true, name: 'config' },
        { aliases: [], argumentsLabel: '[...files]', default: true, description: 'Lint files', hasChildren: false, name: 'lint' },
      ],
      description: 'AI-assisted linting.',
      examples: [],
      flags: [helpFlag, versionFlag],
      help: undefined,
      name: 'alint',
      usage: ['alint <command> [flags]'],
    } satisfies Help)
  })

  it('passes a nested command with its aliases listed by the parent', async () => {
    expect((await captureHelp(['config', 'providers', '-h'])).commands).toStrictEqual([
      { aliases: ['list'], argumentsLabel: '[provider]', default: false, description: 'List providers', hasChildren: false, name: 'ls' },
    ])

    expect(await captureHelp(['config', 'providers', 'list', '-h'])).toStrictEqual({
      arguments: [{ default: undefined, description: 'Provider name', label: '[provider]', name: 'provider', required: false, variadic: false }],
      command: 'alint config providers ls',
      commands: [],
      description: 'List providers',
      examples: [],
      flags: [
        configFlag,
        cacheFlag,
        { choices: undefined, default: undefined, description: 'Use project scope', label: '-l, --local', long: 'local', repeatable: false, short: 'l' },
        helpFlag,
        versionFlag,
      ],
      help: undefined,
      name: 'ls',
      usage: ['alint config providers ls [provider] [flags]'],
    } satisfies Help)
  })

  it('passes defaults, choices, and repeatable flags unformatted', async () => {
    const help = await captureHelp(['lint', '--help'])

    expect(help.arguments).toStrictEqual([{ default: undefined, description: 'Files to lint', label: '[...files]', name: 'files', required: false, variadic: true }])
    expect(help.flags).toStrictEqual([
      configFlag,
      cacheFlag,
      { choices: undefined, default: undefined, description: 'Lint changed files only', label: '--dirty', long: 'dirty', repeatable: false, short: undefined },
      { choices: ['stylish', 'json'], default: 'stylish', description: 'Reporter', label: '-f, --format <stylish|json>', long: 'format', repeatable: false, short: 'f' },
      { choices: undefined, default: undefined, description: 'Run name', label: '--name <name>', long: 'name', repeatable: false, short: undefined },
      { choices: undefined, default: undefined, description: 'Retry count', label: '--retries <n>', long: 'retries', repeatable: false, short: undefined },
      { choices: undefined, default: undefined, description: 'Rule filter', label: '--rule <pattern...>', long: 'rule', repeatable: true, short: undefined },
      { choices: undefined, default: undefined, description: 'Timeout', label: '--timeout-ms <ms>', long: 'timeout-ms', repeatable: false, short: undefined },
      helpFlag,
      versionFlag,
    ])
  })

  it('passes argument defaults, examples, and the help paragraph, without a version flag', async () => {
    const help = await captureHelp(['--help'], renderers => createCli({
      action: () => 0,
      arguments: [
        { description: 'Port', name: 'port', required: true },
        { default: 'dev', description: 'Mode', name: 'mode' },
        { default: ['a', 'b'], description: 'Files', name: 'files', variadic: true },
      ],
      description: 'Serve files',
      examples: ['serve 8080', 'serve 8080 prod\nserve 8080 dev a b'],
      flags: [
        { default: false, description: 'Watch', flag: '--watch' },
        { default: [], description: 'Hosts', flag: '--host <name...>' },
        { default: ['x'], description: 'Tags', flag: '--tag <name...>' },
      ],
      help: 'Serves files over HTTP.',
      name: 'serve',
      ...renderers,
    }))

    expect(help).toStrictEqual({
      arguments: [
        { default: undefined, description: 'Port', label: '<port>', name: 'port', required: true, variadic: false },
        { default: 'dev', description: 'Mode', label: '[mode]', name: 'mode', required: false, variadic: false },
        { default: ['a', 'b'], description: 'Files', label: '[...files]', name: 'files', required: false, variadic: true },
      ],
      command: 'serve',
      commands: [],
      description: 'Serve files',
      examples: ['serve 8080', 'serve 8080 prod\nserve 8080 dev a b'],
      // A boolean default and an empty list are not shown, so they are absent here too.
      flags: [
        { choices: undefined, default: undefined, description: 'Watch', label: '--watch', long: 'watch', repeatable: false, short: undefined },
        { choices: undefined, default: undefined, description: 'Hosts', label: '--host <name...>', long: 'host', repeatable: true, short: undefined },
        { choices: undefined, default: ['x'], description: 'Tags', label: '--tag <name...>', long: 'tag', repeatable: true, short: undefined },
        helpFlag,
      ],
      help: 'Serves files over HTTP.',
      name: 'serve',
      usage: ['serve <port> [mode] [...files] [flags]'],
    } satisfies Help)
  })

  it('renders the default help from the model exactly as without a hook', async () => {
    const cli = createCli({
      action: () => 0,
      arguments: [{ default: ['a', 'b'], description: 'Files', name: 'files', variadic: true }],
      description: 'Serve files',
      examples: ['serve a', 'serve a\nserve b'],
      flags: [{ default: ['x'], description: 'Tags', flag: '-t, --tag <name...>' }],
      help: 'Serves files over HTTP.',
      name: 'serve',
    })
    const io = createMemoryIo()

    await cli.execute(['--help'], io)

    expect(io.stdout.text()).toMatchInlineSnapshot(`
      "Serves files over HTTP.

      Usage
        $ serve [...files] [flags]

      Arguments
        [...files]  Files (default: a, b)

      Flags
        -t, --tag <name...>  Tags (repeatable, default: x)
        -h, --help           Show help

      Examples
        serve a

        serve a
        serve b
      "
    `)
  })

  it.each([
    [['--help']],
    [['lint', '--help']],
    [['config', 'providers', 'ls', '-h']],
    [['config']],
    [['config', 'nope']],
    [['-f', 'xml']],
    [['--retries', '1.5']],
  ])('produces today\'s text for %j when the exported defaults are passed as hooks', async (argv) => {
    const plain = createMemoryIo()
    const hooked = createMemoryIo()

    const plainCode = await createSampleCli(nodeParser, () => 0).execute(argv, plain)
    const hookedCode = await createSampleCli(nodeParser, () => 0, {
      renderHelp: help => renderHelp(help),
      renderUsageError: report => renderUsageError(report),
    }).execute(argv, hooked)

    expect(hookedCode).toBe(plainCode)
    expect(hooked.stdout.text()).toBe(plain.stdout.text())
    expect(hooked.stderr.text()).toBe(plain.stderr.text())
    expect(plain.stdout.text() + plain.stderr.text()).not.toBe('')
  })

  it('passes a UsageError thrown by an action without an issue', async () => {
    const renderUsageError = vi.fn((report: UsageErrorReport) => `custom: ${report.message}\n`)
    const io = createMemoryIo()
    const cli = createSampleCli(nodeParser, () => {
      throw new UsageError('--dirty does not accept files')
    }, { renderUsageError })

    expect(await cli.execute(['src'], io)).toBe(2)
    expect(renderUsageError.mock.calls[0]![0]).toStrictEqual({ command: 'alint lint', issue: undefined, message: '--dirty does not accept files' })
    expect(io.stderr.text()).toBe('custom: --dirty does not accept files\n')
  })

  it('passes a UsageError thrown by an action with its issue', async () => {
    const issue: UsageIssue = { code: 'unexpected-argument', received: 'src' }
    const renderUsageError = vi.fn((_: UsageErrorReport) => 'custom\n')
    const io = createMemoryIo()
    const cli = createSampleCli(nodeParser, () => {
      throw new UsageError('unexpected argument "src"', { issue })
    }, { renderUsageError })

    expect(await cli.execute(['src'], io)).toBe(2)
    expect(renderUsageError.mock.calls[0]![0]).toStrictEqual({ command: 'alint lint', issue, message: 'unexpected argument "src"' })
  })

  it('constructs a UsageError with an optional issue and cause', async () => {
    const error = new UsageError('boom', { cause: 'reason', issue: { code: 'unknown-flag', flag: '--x' } })

    expect(error.message).toBe('boom')
    expect(error.cause).toBe('reason')
    expect(error.issue).toEqual({ code: 'unknown-flag', flag: '--x' })
    expect(new UsageError('plain').issue).toBeUndefined()
  })

  it('leaves version output to the definition', async () => {
    const renderHelp = vi.fn(() => '')
    const io = createMemoryIo()

    expect(await createSampleCli(nodeParser, () => 0, { renderHelp }).execute(['-v'], io)).toBe(0)
    expect(io.stdout.text()).toBe('1.2.3\n')
    expect(renderHelp).not.toHaveBeenCalled()
  })
})
