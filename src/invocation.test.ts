import { describe, expect, it } from 'vitest'

import { defineCommand } from './command'
import { resolveInvocation } from './invocation'
import { nodeParser } from './parsers/node'
import { buildTree } from './tree'

const ls = defineCommand({
  action: () => 0,
  arguments: '[provider]',
  description: 'List providers',
  flags: [{ description: 'Use project scope', flag: '-l, --local' }],
  name: 'ls',
})
const providers = defineCommand({ children: [ls], description: 'Manage providers', name: 'providers' })
const tree = buildTree(defineCommand({ children: [providers], description: 'Tool', name: 'tool' }), '1.0.0')

describe('resolveInvocation', () => {
  it('prepares the action context without running the action', async () => {
    const invocation = await resolveInvocation(tree, nodeParser, ['providers', 'ls', 'openrouter', '-l'])

    expect(invocation.kind).toBe('action')
    expect(invocation.kind === 'action' && invocation.context).toEqual({
      args: { provider: 'openrouter' },
      flags: { local: true },
      path: ['providers', 'ls'],
      rest: [],
    })
  })

  it('points usage errors at the deepest command it reached', async () => {
    const invocation = await resolveInvocation(tree, nodeParser, ['providers', 'ls', '--nope'])

    expect(invocation).toEqual({ kind: 'usage-error', message: 'unknown flag --nope', usage: 'tool providers ls' })
  })

  it('lists the children when a subcommand is missing', async () => {
    const invocation = await resolveInvocation(tree, nodeParser, ['providers'])

    expect(invocation).toEqual({ children: [ls], kind: 'usage-error', message: 'missing command for "tool providers"', usage: 'tool providers' })
  })
})
