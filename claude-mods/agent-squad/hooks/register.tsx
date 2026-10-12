import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { SquadAgent, SquadStatus } from '../types'
import {
  BADGE,
  SPINNER,
  THOUGHTS,
  activityOf,
  barOf,
  elapsed,
  overallOf,
  pickMascot,
  progressOf,
} from './squad'

const PANE = 'agent-squad'
const TITLE = 'Agent squad'
const KEEP = 12
const TICK_MS = 300

const agents = atom({ plugin: 'agent-squad', key: 'agents' } as const, [])
const frame = atom({ plugin: 'agent-squad', key: 'frame' } as const, 0)
const dismissed = atom({ plugin: 'agent-squad', key: 'isDismissed' } as const, false)

// Mirrors of state for the timer, rebuilt by session.start after a reload.
let runningCount = 0
let spawned = 0

async function edit($: EngineInterface, id: string, fn: (a: SquadAgent) => SquadAgent) {
  await update($, agents, list => {
    const kept = list.map(a => (a.id === id ? fn(a) : a))
    runningCount = kept.filter(a => a.status === 'running').length
    return kept
  })
}

function finish(status: SquadStatus, now: number) {
  return (a: SquadAgent): SquadAgent =>
    a.status === 'running' ? { ...a, status, endedAt: now, activity: undefined } : a
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'squad',
      description: 'Show the animated subagent sidebar (`/squad clear` forgets finished agents)',
      argumentHint: '[clear]',
    })
    const list = await read($, agents)
    runningCount = list.filter(a => a.status === 'running').length
    spawned = list.length

    let ticks = 0
    $.clock.every(TICK_MS, () => {
      if (runningCount === 0) return
      ticks++
      void update($, frame, f => (f + 1) % 840).catch(() => {})
      // Every few seconds, catch agents that ended without a turn.complete (killed).
      if (ticks % 10 === 0) void sync($).catch(() => {})
    })

    return next(e)
  })

  on('command.run', { command: 'squad' }, async ($, e) => {
    if (e.args.trim() === 'clear') {
      await update($, agents, list => list.filter(a => a.status === 'running'))
      return { text: 'Agent squad: cleared finished agents.' }
    }
    await update($, dismissed, () => false)
    await $.ui.open({ id: PANE, title: TITLE })
    return { text: 'Agent squad sidebar opened.' }
  })

  on('ui.close', async ($, e, next) => {
    if (e.id === PANE && e.origin.kind === 'person') await update($, dismissed, () => true)
    return next(e)
  })

  on('agent.spawn', async ($, e, next) => {
    const started = await next(e)
    if (!started.agentId) return started

    const now = await $.clock.now()
    const id = started.agentId
    await update($, agents, list => {
      const [icon, color] = pickMascot(list, spawned++)
      const agent: SquadAgent = {
        id,
        description: e.description || e.prompt.slice(0, 60),
        type: e.name ?? e.subagentType,
        icon,
        color,
        status: 'running',
        startedAt: now,
        toolCalls: 0,
        todosDone: 0,
        todosTotal: 0,
        activity: 'warming up',
      }
      // Keep every running agent, and the newest finished ones up to KEEP.
      const finished = list.filter(a => a.status !== 'running')
      const drop = new Set(finished.slice(0, Math.max(0, list.length + 1 - KEEP)).map(a => a.id))
      const kept = [...list.filter(a => !drop.has(a.id)), agent]
      runningCount = kept.filter(a => a.status === 'running').length
      return kept
    })

    if (!(await read($, dismissed))) void $.ui.open({ id: PANE, title: TITLE }).catch(() => {})
    return started
  })

  on('tool.call', async ($, e, next) => {
    const id = e.agentId
    if (id === undefined) return next(e)
    const list = await read($, agents)
    if (!list.some(a => a.id === id)) return next(e)

    const tool = String(e.tool)
    let todos: { done: number; total: number; active?: string } | undefined
    if (e.tool === 'TodoWrite') {
      const items = e.todos ?? []
      todos = {
        done: items.filter(t => t.status === 'completed').length,
        total: items.length,
        active: items.find(t => t.status === 'in_progress')?.activeForm,
      }
    }
    await edit($, id, a => ({
      ...a,
      // A teammate that wakes for another turn is working again.
      status: 'running',
      endedAt: undefined,
      toolCalls: a.toolCalls + 1,
      lastTool: tool,
      todosDone: todos ? todos.done : a.todosDone,
      todosTotal: todos ? todos.total : a.todosTotal,
      activity: todos?.active ?? (a.todosTotal > 0 && !todos ? a.activity : activityOf(tool)),
    }))
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const id = e.agentId
    if (id !== undefined) {
      const status: SquadStatus =
        e.reason === 'answer' ? 'done' : e.reason === 'aborted' ? 'stopped' : 'failed'
      await edit($, id, finish(status, await $.clock.now()))
    }
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const list = await read($, agents)
    const tick = await read($, frame)
    const now = await $.clock.now()
    const width = Math.max(24, e.props.bodyColumns)

    if (list.length === 0) {
      return (
        <Box flexDirection="column">
          <Text>
            🐱{tick % 2 === 0 ? '💤' : ' z'} <Text dimColor>The squad is napping.</Text>
          </Text>
          <Text dimColor wrap="wrap">
            When Claude sends out a subagent, it shows up here with its own mascot and a progress bar.
          </Text>
        </Box>
      )
    }

    const working = list.filter(a => a.status === 'running').length
    const finished = list.length - working
    const overall = overallOf(list, now)
    const overallBar = barOf(overall, width - 6, undefined, tick)

    return (
      <Box flexDirection="column">
        <Text bold>
          🎪 {working} working · {finished} finished
        </Text>
        <Text>
          <Text color="success">{overallBar.done}</Text>
          <Text dimColor>{overallBar.rest}</Text>
          <Text bold> {String(overall).padStart(3)}%</Text>
        </Text>
        {list
          .slice()
          .reverse()
          .map(a => {
            const isRunning = a.status === 'running'
            const { pct, isEstimate } = progressOf(a, now)
            // Mascots hop: each one on its own beat so the squad doesn't move in lockstep.
            const beat = tick + a.id.length
            const hop = isRunning && beat % 4 < 2 ? ' ' : ''
            const thought = isRunning ? THOUGHTS[Math.floor(beat / 2) % THOUGHTS.length] : BADGE[a.status]
            const spin = isRunning ? SPINNER[beat % SPINNER.length] : ''
            const bar = barOf(pct, width - 7, isRunning ? a.icon : undefined, beat)
            const clock = elapsed((a.endedAt ?? now) - a.startedAt)
            const state = isRunning ? `${spin} ${clock}` : `${a.status} in ${clock}`
            const note = isRunning
              ? a.activity
              : a.status === 'done'
                ? `${a.toolCalls} tool calls`
                : a.lastTool && `last: ${activityOf(a.lastTool)}`

            return (
              <Box key={a.id} flexDirection="column" marginTop={1}>
                <Text wrap="truncate-end">
                  {hop}
                  {a.icon}
                  {thought} <Text bold color={a.color}>{a.type}</Text>{' '}
                  <Text dimColor>{state}</Text>
                </Text>
                <Text wrap="truncate-end" dimColor={!isRunning}>
                  {a.description}
                </Text>
                <Text>
                  <Text color={a.status === 'failed' ? 'error' : a.color}>{bar.done}</Text>
                  {bar.rider}
                  <Text dimColor>{bar.rest}</Text>
                  <Text bold={isRunning}>
                    {' '}
                    {String(pct).padStart(3)}%{isEstimate && isRunning ? '~' : ' '}
                  </Text>
                </Text>
                {note && (
                  <Text dimColor italic wrap="truncate-end">
                    ↳ {note}
                    {a.todosTotal > 0 ? ` (${a.todosDone}/${a.todosTotal} todos)` : ''}
                  </Text>
                )}
              </Box>
            )
          })}
      </Box>
    )
  })
}

/** Marks agents the engine no longer runs, for ones killed without a turn.complete. */
async function sync($: EngineInterface) {
  const live = await $.agent.list()
  const byId = new Map(live.map(a => [a.id, a.status]))
  const now = await $.clock.now()
  await update($, agents, list => {
    const kept = list.map(a => {
      if (a.status !== 'running') return a
      const s = byId.get(a.id)
      if (s === 'completed') return finish('done', now)(a)
      if (s === 'failed') return finish('failed', now)(a)
      if (s === 'killed') return finish('stopped', now)(a)
      return a
    })
    runningCount = kept.filter(a => a.status === 'running').length
    return kept
  })
}
