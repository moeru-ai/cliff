import { createMemoryIo } from '@moeru/cliff/testing'
import { expect, it } from 'vitest'

import { cli } from './tool.ts'

it('lists providers in the global scope', async () => {
  const io = createMemoryIo({ cwd: '/project' })

  expect(await cli.execute(['providers', 'ls', 'openrouter'], io)).toBe(0)
  expect(io.stdout.text()).toBe('openrouter (global)\n')
})
