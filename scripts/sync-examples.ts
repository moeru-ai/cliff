// Keeps the README in step with the code it documents. Run it through `pnpm docs:update` after a
// change of `examples/` or of anything that changes help, usage errors, or other output.
//
// Two kinds of marked regions are rewritten in README.md:
//
//   <!-- docs:example examples/tool.ts -->   the file, as a code block
//   <!-- docs:output tool lint --help -->    the output of running that argv, as a console block
//
// The first word of an output marker picks the example CLI by name: `tool` or `tool-zh`.
//
// each closed by `<!-- /docs:example -->` or `<!-- /docs:output -->`. Pass `--check` to fail
// instead of writing when the README is out of date.

import process from 'node:process'

import { readFile, writeFile } from 'node:fs/promises'
import { extname, join } from 'node:path'

import { createMemoryIo } from '@moeru/cliff/testing'

import { cli as localized } from '../examples/localized.ts'
import { cli as tool } from '../examples/tool.ts'

const root = join(import.meta.dirname, '..')
const readmePath = join(root, 'README.md')
const check = process.argv.includes('--check')
const examples = new Map([localized, tool].map(cli => [cli.name, cli]))

const region = /(<!-- docs:(example|output) (.+?) -->\n)[\s\S]*?(<!-- \/docs:\2 -->)/g

async function renderExample(path: string): Promise<string> {
  const source = await readFile(join(root, path), 'utf8')

  return `\`\`\`${extname(path).slice(1)}\n${source.trimEnd()}\n\`\`\`\n`
}

async function renderOutput(command: string): Promise<string> {
  const [name = '', ...argv] = command.split(' ')
  const cli = examples.get(name)

  // The marker names the CLI so the block reads like a shell session, but only the example
  // CLIs can run; a typo here would otherwise document the wrong program.
  if (!cli) {
    throw new Error(`docs:output "${command}" must start with one of ${[...examples.keys()].join(', ')}`)
  }

  const io = createMemoryIo()

  await cli.execute(argv, io)

  // stderr is shown after stdout, which is the order a user sees for the outputs cliff makes:
  // a command writes one of the two, never both interleaved.
  return `\`\`\`console\n$ ${command}\n${(io.stdout.text() + io.stderr.text()).trimEnd()}\n\`\`\`\n`
}

const readme = await readFile(readmePath, 'utf8')
const blocks: Promise<string>[] = []

readme.replace(region, (_match, _open, kind: string, target: string) => {
  blocks.push(kind === 'example' ? renderExample(target) : renderOutput(target))
  return ''
})

const rendered = await Promise.all(blocks)
let index = 0
const synced = readme.replace(region, (_match, open: string, _kind, _target, close: string) => `${open}${rendered[index++]}${close}`)

if (synced === readme) {
  process.stdout.write(`README.md is up to date (${rendered.length} regions)\n`)
}
else if (check) {
  process.stderr.write('README.md is out of date. Run `pnpm docs:update`.\n')
  process.exitCode = 1
}
else {
  await writeFile(readmePath, synced)
  process.stdout.write(`README.md updated (${rendered.length} regions)\n`)
}
