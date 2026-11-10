// Mapping between Hayati tasks and a Notion data source (API 2025-09-03). Pure.
import type { TaskRow } from './task';

export type NotionPropType = 'title' | 'rich_text' | 'status' | 'select' | 'date' | 'checkbox' | 'number' | 'multi_select';
export type SchemaProp = { id: string; name: string; type: string; options?: string[] };
export type Mapping = {
  title: string; // property name
  description?: string;
  status?: string;
  priority?: string;
  due?: string;
  done?: string; // checkbox alternative to status
  tags?: string;
  hayatiId?: string; // rich_text property holding the Hayati task id (dedupe)
};

const lc = (s: string) => s.toLowerCase();
const find = (props: SchemaProp[], types: string[], names: string[]) =>
  props.find((p) => types.includes(p.type) && names.some((n) => lc(p.name) === n)) ?? props.find((p) => types.includes(p.type) && names.some((n) => lc(p.name).includes(n)));

/** Guesses a mapping from a data source schema. Only properties that exist and have a compatible type are used. */
export function guessMapping(props: SchemaProp[]): Mapping | null {
  const title = props.find((p) => p.type === 'title');
  if (!title) return null;
  const m: Mapping = { title: title.name };
  m.status = find(props, ['status', 'select'], ['status', 'الحالة', 'state'])?.name;
  m.priority = find(props, ['select'], ['priority', 'الأولوية', 'اولوية'])?.name;
  m.due = find(props, ['date'], ['due', 'deadline', 'date', 'التاريخ', 'الموعد'])?.name;
  m.done = m.status ? undefined : find(props, ['checkbox'], ['done', 'complete', 'منجز', 'تم'])?.name;
  m.description = find(props, ['rich_text'], ['description', 'notes', 'الوصف', 'ملاحظات'])?.name;
  m.tags = find(props, ['multi_select'], ['tags', 'الوسوم', 'labels'])?.name;
  m.hayatiId = find(props, ['rich_text'], ['hayati id', 'hayati_id'])?.name;
  return m;
}

const STATUS_OUT: Record<string, string[]> = {
  completed: ['Done', 'Complete', 'Completed', 'منجز', 'تم'],
  in_progress: ['In progress', 'In Progress', 'Doing', 'قيد التنفيذ'],
  default: ['Not started', 'To do', 'To Do', 'Todo', 'لم يبدأ'],
};
const pickOption = (options: string[] | undefined, wanted: string[]) => (options ?? []).find((o) => wanted.some((w) => lc(w) === lc(o)));

/** Task → Notion `properties`. Writes only mapped properties; never touches anything else on the page. */
export function taskToProps(t: TaskRow, m: Mapping, schema: SchemaProp[]): Record<string, unknown> {
  const p: Record<string, unknown> = {};
  const typeOf = (name?: string) => schema.find((s) => s.name === name);
  p[m.title] = { title: [{ type: 'text', text: { content: t.title.slice(0, 2000) } }] };
  if (m.description) p[m.description] = { rich_text: t.description ? [{ type: 'text', text: { content: t.description.slice(0, 2000) } }] : [] };
  if (m.status) {
    const s = typeOf(m.status);
    const key = t.completed ? 'completed' : t.status === 'in_progress' ? 'in_progress' : 'default';
    const opt = pickOption(s?.options, STATUS_OUT[key]);
    if (opt) p[m.status] = s?.type === 'status' ? { status: { name: opt } } : { select: { name: opt } };
  }
  if (m.done) p[m.done] = { checkbox: !!t.completed };
  if (m.priority && t.priority) {
    const s = typeOf(m.priority);
    const wanted = { high: ['High', 'عالية', 'عالي', 'P1'], medium: ['Medium', 'متوسطة', 'متوسط', 'P2'], low: ['Low', 'منخفضة', 'منخفض', 'P3'] }[t.priority];
    const opt = pickOption(s?.options, wanted) ?? wanted[0];
    p[m.priority] = { select: { name: opt } };
  }
  if (m.due) {
    const day = t.due_date || t.date;
    p[m.due] = day ? { date: { start: t.time && !t.due_date ? `${day}T${t.time}:00` : day } } : { date: null };
  }
  if (m.tags) p[m.tags] = { multi_select: (t.tags ?? []).slice(0, 20).map((name) => ({ name: name.replace(/,/g, ' ') })) };
  if (m.hayatiId) p[m.hayatiId] = { rich_text: [{ type: 'text', text: { content: t.id } }] };
  return p;
}

const plain = (rich: any[] | undefined) => (rich ?? []).map((r) => r?.plain_text ?? r?.text?.content ?? '').join('');

/** Notion page → task patch (only mapped fields). */
export function pageToPatch(page: any, m: Mapping): Partial<TaskRow> {
  const props = page?.properties ?? {};
  const out: Partial<TaskRow> = {};
  const title = plain(props[m.title]?.title).trim();
  if (title) out.title = title;
  if (m.description && props[m.description]) out.description = plain(props[m.description].rich_text) || undefined;
  if (m.status && props[m.status]) {
    const name = lc(props[m.status].status?.name ?? props[m.status].select?.name ?? '');
    if (STATUS_OUT.completed.some((x) => lc(x) === name)) out.completed = true;
    else {
      out.completed = false;
      if (STATUS_OUT.in_progress.some((x) => lc(x) === name)) out.status = 'in_progress';
    }
  }
  if (m.done && props[m.done]) out.completed = !!props[m.done].checkbox;
  if (m.priority && props[m.priority]?.select?.name) {
    const n = lc(props[m.priority].select.name);
    out.priority = /high|عال|p1/.test(n) ? 'high' : /low|منخفض|p3/.test(n) ? 'low' : 'medium';
  }
  if (m.due && props[m.due]) {
    const start: string | undefined = props[m.due].date?.start;
    if (start) out.due_date = start.slice(0, 10);
    else out.due_date = undefined;
  }
  if (m.tags && props[m.tags]) out.tags = (props[m.tags].multi_select ?? []).map((x: any) => x.name);
  return out;
}

export type Side = { updatedAt: string };
/**
 * Conflict policy: if only one side changed since the last sync it wins. If both changed,
 * the most recent edit wins and the result is flagged so the UI can show it.
 */
export function resolve(local: Side, remote: Side, lastSynced?: string): { winner: 'local' | 'remote' | 'none'; conflict: boolean } {
  const l = !lastSynced || local.updatedAt > lastSynced;
  const r = !lastSynced || remote.updatedAt > lastSynced;
  if (l && !r) return { winner: 'local', conflict: false };
  if (r && !l) return { winner: 'remote', conflict: false };
  if (!l && !r) return { winner: 'none', conflict: false };
  return { winner: local.updatedAt >= remote.updatedAt ? 'local' : 'remote', conflict: true };
}

/** Body for creating a "Hayati Tasks" database under a page the user shared with the integration. */
export const hayatiDatabaseBody = (parentPageId: string) => ({
  parent: { type: 'page_id', page_id: parentPageId },
  title: [{ type: 'text', text: { content: 'Hayati Tasks' } }],
  initial_data_source: {
    properties: {
      Name: { title: {} },
      Status: { select: { options: [{ name: 'Not started' }, { name: 'In progress' }, { name: 'Done' }] } },
      Priority: { select: { options: [{ name: 'High' }, { name: 'Medium' }, { name: 'Low' }] } },
      Due: { date: {} },
      Description: { rich_text: {} },
      Tags: { multi_select: {} },
      'Hayati ID': { rich_text: {} },
    },
  },
});
