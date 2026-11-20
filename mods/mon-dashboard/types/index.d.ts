export type Task = { id: string; content: string; due: string | null; prio: 'p1' | 'p2' | 'p4' }
export type Mail = { id: string; from: string; subject: string; url: string | null }
export type CalEvent = { title: string; start: string | null; location: string | null }
export type Board = {
  tasks: Task[] | null
  mail: Mail[] | null
  cal: CalEvent[] | null
  errors: { tasks?: string; mail?: string; cal?: string }
  updatedAt: number | null
  isLoading: boolean
  done: string[]
}

declare module 'claude-code' {
  interface PluginState {
    'mon-dashboard': { board: Shaped<Board> }
  }
}
