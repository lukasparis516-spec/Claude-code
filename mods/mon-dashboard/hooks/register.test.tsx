import { expect, test } from 'claude-code/testing'

const PANE = {
  plugin: 'mon-dashboard',
  component: 'Pane',
  requestId: 'mon-dashboard',
  props: {
    title: 'Tableau de bord',
    isFocused: false,
    bodyColumns: 50,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

test('le panneau affiche tâches, agenda et mails', async ($, on) => {
  on('command.register', () => ({ value: { command: 'mon-dashboard' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('clock.every', () => ({ value: null }))
  on('ui.toast', () => ({ value: {} }))
  on('mcp.call', (_, e: any) => {
    const data: Record<string, unknown> = {
      'find-tasks-by-date': { tasks: [{ id: '1', content: 'Appeler le garage', priority: 'p1' }] },
      search_threads: { threads: [{ id: 't1', messages: [{ sender: 'Banque <b@x.fr>', subject: 'Facture à valider' }] }] },
      'notion-calendar-list-events': { events: [{ title: 'Dentiste', start: '2026-11-20T14:00:00+01:00' }] },
    }
    return { value: { content: [], isError: false, structuredContent: data[e.tool] ?? {} } }
  })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  for (let i = 0; i < 20; i++) await Promise.resolve()

  for (const surface of ['terminal', 'desktop', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Text', text: /Appeler le garage/ }))?.text).toContain('Appeler le garage')
    expect((await ui.find({ type: 'Text', text: /Dentiste/ }))?.text).toContain('Dentiste')
    expect(await ui.find({ type: 'Text', text: /Facture à valider/ })).toBeDefined()
    await ui.unmount()
  }
})
