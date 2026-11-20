import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { Board, CalEvent, Mail, Task } from '../types'

const PANE = 'mon-dashboard'
const TITLE = 'Tableau de bord'
const DASHBOARD_URL = 'https://claude.ai/artifact/6KxnYmPMtcMrQqpF7f4nKj'
const REFRESH_MS = 5 * 60 * 1000
const TZ = 'Europe/Paris'

const EMPTY: Board = {
  tasks: null,
  mail: null,
  cal: null,
  errors: {},
  updatedAt: null,
  isLoading: false,
  done: [],
}
const board = atom({ plugin: 'mon-dashboard', key: 'board' } as const, EMPTY, {
  shape: 'board-1',
})

// Les noms possibles de chaque connecteur selon l'endroit où tourne la session.
const SERVERS: Record<string, string[]> = {
  Todoist: ['Todoist', 'claude.ai Todoist'],
  Gmail: ['Gmail', 'claude.ai Gmail'],
  Notion: ['Notion', 'claude.ai Notion'],
}

type Api = EngineInterface

async function call(
  $: Api,
  server: string,
  tool: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  let last: unknown = new Error(`${server} introuvable`)
  for (const name of SERVERS[server] ?? [server]) {
    try {
      const res = await $.mcp.call(name, tool, args)
      if (res.isError) {
        const txt = res.content
          .map((b: { type: string; text?: string }) => (b.type === 'text' ? (b.text ?? '') : ''))
          .join(' ')
        throw new Error(txt.slice(0, 160) || `${server} a renvoyé une erreur`)
      }
      if (res.structuredContent != null) return res.structuredContent
      for (const b of res.content) {
        if (b.type === 'text') {
          try {
            return JSON.parse(b.text ?? '')
          } catch {
            /* bloc texte non JSON */
          }
        }
      }
      return null
    } catch (err) {
      last = err
    }
  }
  throw last
}

function message(err: unknown): string {
  const m = err instanceof Error ? err.message : String(err)
  if (/not.?found|introuvable|unknown server|no server/i.test(m))
    return 'connecteur non connecté à cette session'
  return m.slice(0, 120)
}

/* ---------- dates ---------- */
function pad(n: number) {
  return n < 10 ? '0' + n : '' + n
}
function ymd(d: Date) {
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
}
function hhmm(d: Date) {
  try {
    return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: TZ })
  } catch {
    return pad(d.getHours()) + ':' + pad(d.getMinutes())
  }
}
function dayLabel(now: Date) {
  try {
    return now.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: TZ })
  } catch {
    return ymd(now)
  }
}

/* ---------- lecture des sources (mêmes requêtes que le dashboard) ---------- */
function toTasks(p: any): Task[] {
  const list: any[] = (p && p.tasks) || []
  return list.map(t => {
    let d = t.dueDate || t.due_date || (t.due && (t.due.date || t.due.string)) || t.due || null
    if (d && typeof d === 'object') d = d.date || null
    const pr = String(t.priority ?? '').toLowerCase()
    return {
      id: String(t.id ?? ''),
      content: String(t.content || '(sans titre)'),
      due: typeof d === 'string' ? d.slice(0, 10) : null,
      prio: pr === 'p1' || pr === '4' ? 'p1' : pr === 'p2' || pr === '3' ? 'p2' : 'p4',
    }
  })
}

const AUTO_MKT = /(elpais|apple|revolut|linkedin|bdfugue|fft\.fr|aktionnaire|gemini|todoist|google)/i
const KEY = /(action|urgent|important|rappel|échéance|echeance|deadline|facture|paiement|signature|à valider|a valider|confirmer|validation|relance|répondre|repondre|avant le)/i
const SEC = /(alerte de sécurité|new device|nouvel appareil|connexion)/i
function senderName(s: string) {
  const m = s.match(/^\s*"?([^"<]+?)"?\s*<[^>]+>\s*$/)
  if (m && m[1]) return m[1].trim()
  const dom = (s.split('@')[1] ?? '').split('.').slice(-2, -1)[0] || s.split('@')[0] || s
  return dom.charAt(0).toUpperCase() + dom.slice(1)
}
function toMail(p: any): Mail[] {
  const out: Mail[] = []
  for (const th of (p && p.threads) || []) {
    const msgs = th.messages || []
    const m = msgs[msgs.length - 1] || {}
    const from = String(m.sender || '')
    const subj = String(m.subject || '')
    const starred = (m.labelIds || []).indexOf('STARRED') >= 0
    const isAction = (KEY.test(subj) && !SEC.test(subj) && !AUTO_MKT.test(from)) || starred
    if (!isAction) continue
    const url = th.viewUrl || m.viewUrl
    out.push({
      id: String(th.id ?? ''),
      from: senderName(from),
      subject: subj || '(sans objet)',
      url: typeof url === 'string' && /^https:\/\//.test(url) ? url : null,
    })
  }
  return out
}
function toCal(p: any): CalEvent[] {
  const list: any[] = Array.isArray(p) ? p : (p && (p.events || p.items)) || []
  return list
    .map(e => {
      let s = e.start || e.startTime || e.start_time
      if (s && typeof s === 'object') s = s.dateTime || s.date || s.value
      return {
        title: String(e.title || e.summary || e.name || '(sans titre)'),
        start: s ? String(s) : null,
        location: e.location ? String(e.location) : null,
      }
    })
    .sort((a, b) => String(a.start).localeCompare(String(b.start)))
}

async function refresh($: Api) {
  await update($, board, b => ({ ...b, isLoading: true }))
  const now = new Date()
  const a = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const z = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)

  const [tasks, mail, cal] = await Promise.allSettled([
    call($, 'Todoist', 'find-tasks-by-date', { startDate: 'today', daysCount: 7, limit: 50 }),
    call($, 'Gmail', 'search_threads', {
      query: 'in:inbox is:unread newer_than:14d -category:promotions -category:social -category:forums',
      pageSize: 40,
      view: 'THREAD_VIEW_SUMMARY',
    }),
    call($, 'Notion', 'notion-calendar-list-events', {
      timeMin: a.toISOString(),
      timeMax: z.toISOString(),
      timeZone: TZ,
    }),
  ])

  await update($, board, b => ({
    ...b,
    tasks: tasks.status === 'fulfilled' ? toTasks(tasks.value) : b.tasks,
    mail: mail.status === 'fulfilled' ? toMail(mail.value) : b.mail,
    cal: cal.status === 'fulfilled' ? toCal(cal.value) : b.cal,
    errors: {
      tasks: tasks.status === 'rejected' ? message(tasks.reason) : undefined,
      mail: mail.status === 'rejected' ? message(mail.reason) : undefined,
      cal: cal.status === 'rejected' ? message(cal.reason) : undefined,
    },
    done: [],
    updatedAt: Date.now(),
    isLoading: false,
  }))
}

export const register: Register = on => {
  let timer: Timer | undefined

  on('session.start', async ($, e, next) => {
    try {
      await $.command.register({
        name: 'mon-dashboard',
        description: 'Ouvre ou actualise ton tableau de bord à côté du chat',
      })
    } catch {
      /* la commande est un plus : le panneau s'ouvre quand même */
    }
    void $.ui.open({ id: PANE, title: TITLE })
    void refresh($)
    try {
      timer?.cancel()
      timer = $.clock.every(REFRESH_MS, () => void refresh($))
    } catch {
      /* sans minuterie, le bouton Actualiser reste là */
    }
    return next(e)
  })

  on('command.run', { command: 'mon-dashboard' }, async $ => {
    await $.ui.open({ id: PANE, title: TITLE })
    void refresh($)
    return { text: 'Tableau de bord ouvert et en cours d’actualisation.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button, Input, Link } = $.ui.resolve(e)
    const b = await read($, board)
    const now = new Date()
    const today = ymd(now)

    const tasks = (b.tasks ?? []).filter(t => b.done.indexOf(t.id) < 0)
    const late = tasks.filter(t => t.due && t.due < today)
    const todayT = tasks.filter(t => !t.due || t.due === today)
    const soon = tasks.filter(t => t.due && t.due > today)
    const mails = b.mail ?? []
    const evs = b.cal ?? []
    const total = late.length + todayT.length + mails.length

    const headline =
      b.tasks === null && b.mail === null
        ? 'Je regarde ta journée…'
        : total === 0
          ? 'Journée dégagée.'
          : `${total} priorité${total > 1 ? 's' : ''} aujourd’hui`
    const fresh = b.isLoading
      ? 'Actualisation…'
      : b.updatedAt
        ? `Mis à jour à ${hhmm(new Date(b.updatedAt))}`
        : ''

    // Version compacte quand le panneau est réduit en widget.
    if (e.props.placement === 'widget') {
      return (
        <Box flexDirection="column">
          <Text bold>{headline}</Text>
          <Text dimColor>
            {todayT.length + late.length} tâches · {mails.length} mails · {evs.length} évén.
          </Text>
        </Box>
      )
    }

    const complete = async (t: Task) => {
      await update($, board, x => ({ ...x, done: [...x.done, t.id] }))
      try {
        await call($, 'Todoist', 'complete-tasks', { ids: [t.id] })
        $.ui.toast(`Terminé : ${t.content}`)
      } catch (err) {
        await update($, board, x => ({ ...x, done: x.done.filter(id => id !== t.id) }))
        $.ui.toast(`Todoist : ${message(err)}`)
      }
      void refresh($)
    }
    const addTask = async (content: string) => {
      const v = content.trim()
      if (!v) return
      try {
        await call($, 'Todoist', 'add-tasks', { tasks: [{ content: v, dueString: 'today' }] })
        $.ui.toast(`Tâche ajoutée : ${v}`)
      } catch (err) {
        $.ui.toast(`Todoist : ${message(err)}`)
      }
      void refresh($)
    }
    const taskRow = (t: Task, isLate: boolean) => (
      <Box key={'t' + t.id} flexDirection="row" gap={1}>
        <Button key={'done-' + t.id} plain label="○" onPress={() => void complete(t)} />
        <Box flexDirection="column" flexShrink={1}>
          <Text color={t.prio === 'p1' ? 'red' : undefined} wrap="wrap">
            {t.content}
          </Text>
          {t.due && t.due !== today && (
            <Text dimColor={!isLate} color={isLate ? 'red' : undefined} size="footnote">
              {t.due}
            </Text>
          )}
        </Box>
      </Box>
    )
    const err = (k: 'tasks' | 'mail' | 'cal', name: string) =>
      b.errors[k] ? (
        <Text color="yellow" size="footnote">
          {name} : {b.errors[k]}
        </Text>
      ) : null

    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="column">
          <Text dimColor size="footnote">
            {dayLabel(now)}
          </Text>
          <Text bold size="heading">
            {headline}
          </Text>
          <Box flexDirection="row" gap={2} flexWrap="wrap">
            <Text dimColor size="footnote">
              {fresh}
            </Text>
            <Button key="refresh" plain label="↻ Actualiser" onPress={() => void refresh($)} />
            <Link href={DASHBOARD_URL} label="Dashboard complet ↗" />
          </Box>
        </Box>

        <Box flexDirection="column">
          <Text bold>Tâches ({late.length + todayT.length})</Text>
          {err('tasks', 'Todoist')}
          {late.length > 0 && <Text color="red" size="footnote">En retard</Text>}
          {late.map(t => taskRow(t, true))}
          {todayT.length > 0 && <Text dimColor size="footnote">Aujourd’hui</Text>}
          {todayT.map(t => taskRow(t, false))}
          {soon.length > 0 && <Text dimColor size="footnote">À venir</Text>}
          {soon.slice(0, 5).map(t => taskRow(t, false))}
          {b.tasks !== null && tasks.length === 0 && <Text dimColor>Rien de prévu.</Text>}
          <Input
            key="add-task"
            placeholder="Nouvelle tâche pour aujourd’hui"
            submitLabel="Ajouter"
            onSubmit={v => void addTask(v)}
          />
        </Box>

        <Box flexDirection="column">
          <Text bold>Agenda ({evs.length})</Text>
          {err('cal', 'Notion')}
          {b.cal !== null && evs.length === 0 && <Text dimColor>Rien de prévu aujourd’hui.</Text>}
          {evs.map((ev, i) => {
            const d = ev.start ? new Date(ev.start) : null
            const time =
              !ev.start || ev.start.length <= 10 || !d || isNaN(d.getTime()) ? 'Jour' : hhmm(d)
            return (
              <Box key={'e' + i} flexDirection="row" gap={1}>
                <Text color="cyan" tabular>
                  {time}
                </Text>
                <Text wrap="wrap">
                  {ev.title}
                  {ev.location ? ` · ${ev.location}` : ''}
                </Text>
              </Box>
            )
          })}
        </Box>

        <Box flexDirection="column">
          <Text bold>Mails à traiter ({mails.length})</Text>
          {err('mail', 'Gmail')}
          {b.mail !== null && mails.length === 0 && <Text dimColor>Aucune action attendue.</Text>}
          {mails.slice(0, 6).map(m => (
            <Box key={'m' + m.id} flexDirection="column">
              <Text wrap="wrap">
                <Text bold>{m.from}</Text> : {m.subject}
              </Text>
              <Box flexDirection="row" gap={2} flexWrap="wrap">
                <Button
                  key={'mt-' + m.id}
                  plain
                  label="+ Tâche"
                  onPress={() => void addTask(`Traiter : ${m.subject.slice(0, 120)} (${m.from})`)}
                />
                <Button
                  key={'mc-' + m.id}
                  plain
                  label="Demander à Claude"
                  onPress={() =>
                    void $.prompt.fill({
                      text: `Aide-moi à traiter ce mail de ${m.from} : « ${m.subject} » (fil Gmail ${m.id}). `,
                    })
                  }
                />
                {m.url && <Link href={m.url} label="Ouvrir ↗" />}
              </Box>
            </Box>
          ))}
        </Box>
      </Box>
    )
  })
}
