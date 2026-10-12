export type SquadStatus = 'running' | 'done' | 'failed' | 'stopped'

export type SquadAgent = {
  id: string
  description: string
  type: string
  icon: string
  color: string
  status: SquadStatus
  startedAt: number
  endedAt?: number
  toolCalls: number
  lastTool?: string
  todosDone: number
  todosTotal: number
  activity?: string
}

declare module 'claude-code' {
  interface PluginState {
    'agent-squad': { agents: SquadAgent[]; frame: number; isDismissed: boolean }
  }
}
