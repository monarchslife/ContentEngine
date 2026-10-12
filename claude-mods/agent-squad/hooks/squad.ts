import type { SquadAgent } from '../types'

/** The mascots, handed out in order; a running agent's mascot is never reused. */
export const CAST: ReadonlyArray<readonly [icon: string, color: string]> = [
  ['🦊', '#ff8c42'],
  ['🐼', '#e0e0e0'],
  ['🐸', '#5cc85c'],
  ['🐙', '#e05cc8'],
  ['🦉', '#c08552'],
  ['🐧', '#4fc3f7'],
  ['🐯', '#ffb300'],
  ['🦄', '#c792ff'],
  ['🐢', '#66bb6a'],
  ['🐝', '#ffd400'],
  ['🐳', '#42a5f5'],
  ['🐨', '#9e9e9e'],
]

/** What floats beside a working mascot, one per animation frame. */
export const THOUGHTS = ['💭', '💡', '⚡', '✨']
export const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
const EDGE = ['▏', '▎', '▍', '▌', '▋', '▊', '▉']

export const BADGE: Record<SquadAgent['status'], string> = {
  running: '',
  done: '🏁',
  failed: '💥',
  stopped: '💤',
}

export function pickMascot(agents: SquadAgent[], spawned: number): readonly [string, string] {
  const busy = new Set(agents.filter(a => a.status === 'running').map(a => a.icon))
  for (let i = 0; i < CAST.length; i++) {
    const one = CAST[(spawned + i) % CAST.length]!
    if (!busy.has(one[0])) return one
  }
  return CAST[spawned % CAST.length]!
}

/**
 * Percent complete. A subagent that keeps a todo list is measured by it;
 * otherwise the estimate climbs with its tool calls and time, flattening
 * toward 95% so it never claims to be done before it is.
 */
export function progressOf(a: SquadAgent, now: number): { pct: number; isEstimate: boolean } {
  if (a.status === 'done') return { pct: 100, isEstimate: false }
  if (a.todosTotal > 0) {
    const pct = Math.round((a.todosDone / a.todosTotal) * 100)
    return { pct: a.status === 'running' ? Math.min(pct, 99) : pct, isEstimate: false }
  }
  const effort = a.toolCalls + ((a.endedAt ?? now) - a.startedAt) / 20_000
  return { pct: Math.floor(95 * (1 - Math.exp(-effort / 12))), isEstimate: true }
}

/** A bar `width` cells wide; a running agent's mascot rides its front edge. */
export function barOf(pct: number, width: number, rider: string | undefined, frame: number) {
  const cells = Math.max(4, width) - (rider ? 2 : 0)
  const exact = (pct / 100) * cells
  let full = Math.floor(exact)
  let edge = ''
  if (full < cells && rider) {
    edge = EDGE[(frame + Math.floor((exact - full) * EDGE.length)) % EDGE.length]!
    full = Math.min(full, cells - 1)
  }
  const rest = Math.max(0, cells - full - edge.length)
  return { done: '█'.repeat(full) + edge, rider: rider ?? '', rest: '░'.repeat(rest) }
}

export function elapsed(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000))
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`
}

const VERBS: Record<string, string> = {
  Read: 'reading',
  Grep: 'searching',
  Glob: 'scanning files',
  Bash: 'running a command',
  Edit: 'editing',
  Write: 'writing',
  WebFetch: 'fetching a page',
  WebSearch: 'searching the web',
  TodoWrite: 'planning',
  Agent: 'delegating',
}

export function activityOf(tool: string): string {
  if (tool.startsWith('mcp__')) return `using ${tool.split('__').slice(1).join(' ')}`
  return VERBS[tool] ?? `using ${tool}`
}

export function overallOf(agents: SquadAgent[], now: number) {
  if (agents.length === 0) return 0
  const sum = agents.reduce((n, a) => n + progressOf(a, now).pct, 0)
  return Math.round(sum / agents.length)
}
