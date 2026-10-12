import { describe, expect, mock, test } from 'claude-code/testing'

import { barOf, progressOf } from '../hooks/squad'
import type { SquadAgent } from '../types'

const base: SquadAgent = {
  id: 'a1',
  description: 'Find the bug',
  type: 'Explore',
  icon: '🦊',
  color: '#ff8c42',
  status: 'running',
  startedAt: 0,
  toolCalls: 0,
  todosDone: 0,
  todosTotal: 0,
}

describe('progress', () => {
  test('a todo list measures it, held under 100 while running', () => {
    expect(progressOf({ ...base, todosDone: 2, todosTotal: 4 }, 0)).toEqual({ pct: 50, isEstimate: false })
    expect(progressOf({ ...base, todosDone: 4, todosTotal: 4 }, 0).pct).toBe(99)
  })

  test('without todos it estimates, climbing but never reaching 100', () => {
    const early = progressOf({ ...base, toolCalls: 2 }, 10_000).pct
    const late = progressOf({ ...base, toolCalls: 40 }, 600_000).pct
    expect(early).toBeLessThan(late)
    expect(late).toBeLessThan(96)
  })

  test('done is 100', () => {
    expect(progressOf({ ...base, status: 'done' }, 0).pct).toBe(100)
  })

  test('the bar keeps its width with the mascot riding it', () => {
    for (const pct of [0, 13, 50, 99]) {
      const b = barOf(pct, 20, '🦊', 3)
      expect(b.done.length + 2 + b.rest.length).toBe(20)
    }
  })
})

test('a subagent shows in the pane with its mascot, task and progress', async ($, on) => {
  on('agent.spawn', () => ({ model: 'haiku', agentId: 'agent-1' }))
  mock.clock(on)
  on('tool.call', () => ({ result: 'ok' }) as never)
  on('turn.complete', () => ({ text: '' }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))

  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.agent.spawn({
    tool_use_id: 't1',
    prompt: 'Look through the repo for TODOs',
    description: 'Hunt TODOs',
    subagentType: 'Explore',
    provider: { plugin: 'engine', tier: 'core' },
    parentModel: 'opus',
    background: false,
    fork: false,
  } as never)
  await $.tool.call({
    tool: 'TodoWrite',
    tool_use_id: 't2',
    agentId: 'agent-1',
    todos: [
      { content: 'a', status: 'completed', activeForm: 'Doing a' },
      { content: 'b', status: 'in_progress', activeForm: 'Scanning src' },
    ],
  } as never)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({
      plugin: 'agent-squad',
      surface,
      component: 'Pane',
      requestId: 'agent-squad',
      props: { bodyColumns: 40 } as never,
    })
    expect(await ui.find({ type: 'Text', text: /Hunt TODOs/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Explore/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /50%/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Scanning src/ })).toBeDefined()
    await ui.unmount()
  }

  await $.turn.complete({
    answer: 'done',
    durationMs: 10,
    isAborted: false,
    turnId: 'x',
    agentId: 'agent-1',
    reason: 'answer',
  })
  const ui = await $.ui.mount({
    plugin: 'agent-squad',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'agent-squad',
    props: { bodyColumns: 40 } as never,
  })
  expect(await ui.find({ type: 'Text', text: /100%/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /done in/ })).toBeDefined()
})
