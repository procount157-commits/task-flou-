import React, { useMemo, useState } from 'react';
import { View } from 'react-native';

import { useAI } from './Today';
import { PALETTE, useLang, useTheme } from '@/ctx/Lang';
import { isDate, lastMonths, monthKey, shiftMonth, today } from '@/lib/dates';
import { db, useEntity } from '@/lib/db';
import { shareFile } from '@/lib/gcal';
import { ExtractDataFromUploadedFile, col, pickDocument, suggestGifts } from '@/lib/integrations';
import { money, pct } from '@/lib/logic';
import type { Client, FinanceGoal, GiftSuggestion, Salary, Transaction, TxCategory } from '@/lib/types';
import { HBars, LineChart, PieChart } from '@/ui/charts';
import { FormModal } from '@/ui/Form';
import { Badge, Btn, Card, Chips, Empty, IconBtn, Input, Loading, Progress, Row, Screen, Stat, Tabs, Txt, confirm, notice, opts } from '@/ui/kit';

const TX_CATS: TxCategory[] = ['salary', 'freelance', 'investment', 'food', 'transport', 'housing', 'health', 'education', 'entertainment', 'shopping', 'utilities', 'savings', 'other'];
const catColor = (cat: string) => PALETTE[Math.max(0, TX_CATS.indexOf(cat as TxCategory)) % PALETTE.length];

// Linked income moves a finance goal's saved amount; `sign` is -1 when a transaction is removed or replaced.
async function applyToGoal(tx: Pick<Transaction, 'goal_id' | 'type' | 'amount'>, sign: 1 | -1) {
  if (!tx.goal_id || tx.type !== 'income') return;
  const goal = (await db.list('FinanceGoal')).find((g) => g.id === tx.goal_id);
  if (!goal) return;
  const current_amount = Math.max(0, (goal.current_amount ?? 0) + sign * tx.amount);
  await db.update('FinanceGoal', goal.id, { current_amount, is_completed: current_amount >= goal.target_amount });
}

function byCategory(txs: Transaction[], label: (c: TxCategory) => string) {
  const sums = new Map<TxCategory, number>();
  for (const x of txs) if (x.type === 'expense') sums.set(x.category ?? 'other', (sums.get(x.category ?? 'other') ?? 0) + x.amount);
  return [...sums.entries()].sort((a, b) => b[1] - a[1]).map(([cat, value]) => ({ label: label(cat), value, color: catColor(cat) }));
}

export default function Finance() {
  const c = useTheme();
  const { t, lang } = useLang();
  const ai = useAI();
  const txs = useEntity('Transaction');
  const goals = useEntity('FinanceGoal');
  const salaries = useEntity('Salary');
  const gifts = useEntity('GiftSuggestion');
  const clients = useEntity('Client');
  const [tab, setTab] = useState('0');
  const [filter, setFilter] = useState<'all' | TxCategory>('all');
  const [txForm, setTxForm] = useState<Partial<Transaction> | null>(null);
  const [goalForm, setGoalForm] = useState<Partial<FinanceGoal> | null>(null);
  const [salaryForm, setSalaryForm] = useState<Partial<Salary> | null>(null);
  const [clientForm, setClientForm] = useState<Partial<Client> | null>(null);
  const [giftForm, setGiftForm] = useState(false);
  const [month, setMonth] = useState(monthKey(today()));
  const cur = t.c.currency;
  const sum = (xs: Transaction[], type: 'income' | 'expense') => xs.filter((x) => x.type === type).reduce((s, x) => s + x.amount, 0);
  const income = sum(txs.items, 'income');
  const expense = sum(txs.items, 'expense');
  const sorted = useMemo(() => [...txs.items].sort((a, b) => b.date.localeCompare(a.date)), [txs.items]);
  const del = (run: () => unknown) => confirm(t.c.confirmDelete, run, t.c.delete, t.c.cancel);

  const importTx = async () => {
    const doc = await pickDocument();
    if (!doc) return;
    try {
      const rows = await ExtractDataFromUploadedFile(doc.uri);
      const data = rows.map((r) => {
        const amount = Number(col(r, 'amount', 'المبلغ').replace(/[^\d.-]/g, ''));
        const rawType = col(r, 'type', 'النوع').toLowerCase();
        const cat = col(r, 'category', 'التصنيف').toLowerCase() as TxCategory;
        const date = col(r, 'date', 'التاريخ').slice(0, 10);
        return {
          title: col(r, 'title', 'العنوان', 'description', 'الوصف'), amount: Math.abs(amount),
          type: (rawType ? /income|دخل|إيراد/.test(rawType) : amount > 0) ? ('income' as const) : ('expense' as const),
          category: TX_CATS.includes(cat) ? cat : ('other' as TxCategory), date: isDate(date) ? date : today(), note: col(r, 'note', 'ملاحظة', 'ملاحظات') || undefined,
        };
      }).filter((x) => x.title && x.amount > 0);
      await db.bulkCreate('Transaction', data);
      notice(`${t.c.imported}: ${data.length}`);
    } catch {
      notice(t.c.importFailed);
    }
  };

  const monthTx = txs.items.filter((x) => monthKey(x.date) === month);
  const exportCsv = () => {
    const q = (s: unknown) => `"${String(s ?? '').replace(/"/g, '""')}"`;
    const lines = [['title', 'amount', 'type', 'category', 'date', 'note'].join(','), ...monthTx.map((x) => [q(x.title), x.amount, x.type, x.category ?? 'other', x.date, q(x.note)].join(','))];
    // the BOM keeps Arabic readable when the file is opened in Excel
    shareFile(`finance-${month}.csv`, '﻿' + lines.join('\n'), 'text/csv');
  };

  const tabs: Record<string, () => React.ReactNode> = {
    0: () => {
      const list = sorted.filter((x) => filter === 'all' || (x.category ?? 'other') === filter);
      return (
        <>
          <Row>
            <Btn title={`+ ${t.fin.addTx}`} onPress={() => setTxForm({})} style={{ flex: 1 }} />
            <Btn kind="ghost" title={`⬆ ${t.c.importFile}`} onPress={importTx} />
          </Row>
          <Chips scroll options={[{ value: 'all' as const, label: t.c.all }, ...opts(t.txCat)]} value={filter} onChange={setFilter} />
          {txs.loading ? <Loading /> : !list.length ? <Empty icon="💸" text={t.fin.noTx} /> : list.map((x) => (
            <Card key={x.id}>
              <Row>
                <View style={{ flex: 1 }}>
                  <Txt style={{ fontWeight: '600' }}>{x.title}</Txt>
                  <Txt v="small">{[x.date, t.txCat[x.category ?? 'other'], x.recurring && `🔁 ${t.fin.recurring}`, x.goal_id && `🎯 ${goals.items.find((g) => g.id === x.goal_id)?.title ?? ''}`].filter(Boolean).join(' · ')}</Txt>
                  {x.note ? <Txt v="muted">{x.note}</Txt> : null}
                </View>
                <Txt style={{ fontWeight: '700' }} color={x.type === 'income' ? c.success : c.danger}>{x.type === 'income' ? '+' : '−'}{money(x.amount)} {cur}</Txt>
              </Row>
              <Row gap={2}>
                <IconBtn icon="✏️" label={t.c.edit} onPress={() => setTxForm(x)} />
                <IconBtn icon="🗑" label={t.c.delete} onPress={() => del(async () => { await applyToGoal(x, -1); await txs.remove(x.id); })} />
              </Row>
            </Card>
          ))}
        </>
      );
    },
    1: () => {
      const months = lastMonths(6);
      const cats = byCategory(txs.items, (k) => t.txCat[k]);
      return (
        <>
          <Card>
            <Txt v="sub">{t.fin.monthlyBalance}</Txt>
            <LineChart data={months.map((m) => { const xs = txs.items.filter((x) => monthKey(x.date) === m); return { label: m.slice(5), value: sum(xs, 'income') - sum(xs, 'expense') }; })} />
          </Card>
          <Card>
            <Txt v="sub">{t.fin.byCategory}</Txt>
            {cats.length ? <PieChart data={cats} /> : <Txt v="muted">{t.fin.noData}</Txt>}
          </Card>
        </>
      );
    },
    2: () => (
      <>
        <Btn title={`+ ${t.fin.addGoal}`} onPress={() => setGoalForm({})} />
        {!goals.items.length ? <Empty icon="🏦" text={t.c.empty} /> : goals.items.map((g) => {
          const done = (g.current_amount ?? 0) >= g.target_amount;
          return (
            <Card key={g.id}>
              <Row>
                <Txt style={{ flex: 1, fontWeight: '600' }}>{g.title}</Txt>
                <Badge text={t.finCat[g.category ?? 'other']} />
                {done ? <Badge text={`✓ ${t.c.completed}`} color={c.success} /> : null}
              </Row>
              <Progress value={pct(g.current_amount ?? 0, g.target_amount)} color={done ? c.success : undefined} />
              <Txt v="small">{money(g.current_amount ?? 0)} / {money(g.target_amount)} {cur} · {pct(g.current_amount ?? 0, g.target_amount)}%{g.deadline ? ` · 📅 ${g.deadline}` : ''} · {txs.items.filter((x) => x.goal_id === g.id).length} {t.fin.txCount}</Txt>
              <Row gap={2}>
                <Btn small kind="ghost" title={`+ ${t.fin.addTx}`} onPress={() => setTxForm({ goal_id: g.id, type: 'income', category: 'savings', title: g.title })} />
                <IconBtn icon="✏️" label={t.c.edit} onPress={() => setGoalForm(g)} />
                <IconBtn icon="🗑" label={t.c.delete} onPress={() => del(() => goals.remove(g.id))} />
              </Row>
            </Card>
          );
        })}
      </>
    ),
    3: () => (
      <>
        <Btn title={`+ ${t.fin.addSalary}`} onPress={() => setSalaryForm({})} />
        <Stat label={t.c.total} value={`${money(salaries.items.reduce((s, x) => s + x.amount, 0))} ${cur}`} />
        {!salaries.items.length ? <Empty icon="💼" text={t.c.empty} /> : [...salaries.items].sort((a, b) => b.date.localeCompare(a.date)).map((s) => (
          <Card key={s.id}>
            <Row>
              <View style={{ flex: 1 }}>
                <Txt style={{ fontWeight: '600' }}>{s.title}</Txt>
                <Txt v="small">{[s.date, t.salaryType[s.type ?? 'monthly'], s.source].filter(Boolean).join(' · ')}</Txt>
                {s.note ? <Txt v="muted">{s.note}</Txt> : null}
              </View>
              <Txt style={{ fontWeight: '700' }} color={c.success}>{money(s.amount)} {cur}</Txt>
              <IconBtn icon="✏️" label={t.c.edit} onPress={() => setSalaryForm(s)} />
              <IconBtn icon="🗑" label={t.c.delete} onPress={() => del(() => salaries.remove(s.id))} />
            </Row>
          </Card>
        ))}
      </>
    ),
    4: () => (
      <>
        <Btn title={`🎁 ${t.fin.newGift}`} onPress={() => setGiftForm(true)} />
        {!gifts.items.length ? <Empty icon="🎁" text={t.fin.giftPrompt} /> : [...gifts.items].reverse().map((g: GiftSuggestion) => (
          <Card key={g.id}>
            <Row>
              <View style={{ flex: 1 }}>
                <Txt style={{ fontWeight: '600' }}>{g.recipient_name} — {g.occasion}</Txt>
                <Txt v="small">{money(g.budget_min ?? 0)}–{money(g.budget_max ?? 0)} {cur}{g.purchase_date ? ` · ${g.purchase_date}` : ''}</Txt>
              </View>
              {g.is_purchased ? <Badge text={`✓ ${t.fin.purchased}`} color={c.success} /> : null}
              <IconBtn icon="🗑" label={t.c.delete} onPress={() => del(() => gifts.remove(g.id))} />
            </Row>
            <Chips options={(g.suggestions ?? []).map((s) => ({ value: s, label: s }))} value={g.selected_gift} onChange={(selected_gift) => gifts.update(g.id, { selected_gift })} />
            {g.selected_gift ? (
              <Row>
                <Txt v="muted" style={{ flex: 1 }}>{t.fin.selected}: {g.selected_gift}</Txt>
                <Btn small kind={g.is_purchased ? 'ghost' : 'primary'} title={g.is_purchased ? t.fin.purchased : t.fin.markPurchased} onPress={() => gifts.update(g.id, { is_purchased: !g.is_purchased, purchase_date: g.is_purchased ? undefined : today() })} />
              </Row>
            ) : null}
          </Card>
        ))}
      </>
    ),
    5: () => (
      <>
        <Btn title={`+ ${t.fin.addClient}`} onPress={() => setClientForm({})} />
        <Stat label={t.fin.totalPaid} value={`${money(clients.items.reduce((s, x) => s + (x.total_paid ?? 0), 0))} ${cur}`} />
        {!clients.items.length ? <Empty icon="🤝" text={t.c.empty} /> : clients.items.map((cl) => (
          <Card key={cl.id}>
            <Row>
              <View style={{ flex: 1 }}>
                <Txt style={{ fontWeight: '600' }}>{cl.name}</Txt>
                <Txt v="small">{[cl.company, cl.email, cl.phone].filter(Boolean).join(' · ')}</Txt>
                {cl.notes ? <Txt v="muted">{cl.notes}</Txt> : null}
              </View>
              <View style={{ alignItems: 'flex-end', gap: 3 }}>
                <Txt style={{ fontWeight: '700' }}>{money(cl.total_paid ?? 0)} {cur}</Txt>
                <Badge text={t.clientStatus[cl.status ?? 'active']} />
              </View>
            </Row>
            <Row gap={2}>
              <IconBtn icon="✏️" label={t.c.edit} onPress={() => setClientForm(cl)} />
              <IconBtn icon="🗑" label={t.c.delete} onPress={() => del(() => clients.remove(cl.id))} />
            </Row>
          </Card>
        ))}
      </>
    ),
    6: () => {
      const cats = byCategory(txs.items, (k) => t.txCat[k]);
      return !cats.length ? <Empty icon="📊" text={t.fin.noData} /> : (
        <Card>
          <Txt v="sub">{t.fin.byCategory}</Txt>
          <HBars data={cats.map((x) => ({ label: `${x.label} — ${money(x.value)} ${cur}`, value: pct(x.value, expense), color: x.color }))} />
        </Card>
      );
    },
    7: () => {
      const cats = byCategory(monthTx, (k) => t.txCat[k]);
      const inc = sum(monthTx, 'income');
      const exp = sum(monthTx, 'expense');
      return (
        <>
          <Row>
            <Btn small kind="ghost" title="‹" onPress={() => setMonth(shiftMonth(month, -1))} />
            <View style={{ flex: 1 }}><Input value={month} onChangeText={setMonth} placeholder={t.fin.monthPh} keyboardType="numbers-and-punctuation" /></View>
            <Btn small kind="ghost" title="›" onPress={() => setMonth(shiftMonth(month, 1))} />
          </Row>
          <Row wrap>
            <Stat label={t.fin.income} value={`${money(inc)} ${cur}`} />
            <Stat label={t.fin.expense} value={`${money(exp)} ${cur}`} />
            <Stat label={t.fin.balance} value={`${money(inc - exp)} ${cur}`} />
            <Stat label={t.fin.txCount} value={monthTx.length} />
          </Row>
          <Card>
            <Txt v="sub">{t.fin.byCategory}</Txt>
            {cats.length ? <PieChart data={cats} /> : <Txt v="muted">{t.fin.noData}</Txt>}
          </Card>
          <Btn title={`⬇ ${t.fin.exportCsv}`} disabled={!monthTx.length} onPress={exportCsv} />
        </>
      );
    },
  };

  return (
    <Screen>
      <Row wrap>
        <Stat label={t.fin.income} value={`${money(income)} ${cur}`} />
        <Stat label={t.fin.expense} value={`${money(expense)} ${cur}`} />
        <Stat label={t.fin.balance} value={`${money(income - expense)} ${cur}`} />
      </Row>
      <Tabs options={t.fin.tabs.map((label, i) => ({ value: String(i), label }))} value={tab} onChange={setTab} />
      {tabs[tab]()}

      <FormModal visible={!!txForm} title={txForm?.id ? t.c.edit : t.fin.addTx} initial={{ type: 'expense', category: 'other', date: today(), recurring: false, ...txForm }} onClose={() => setTxForm(null)}
        fields={[
          { key: 'title', label: t.c.title, required: true },
          { key: 'amount', label: `${t.c.amount} (${cur})`, type: 'number', required: true },
          { key: 'type', label: t.c.type, type: 'select', options: opts(t.txType), required: true },
          { key: 'category', label: t.c.category, type: 'select', options: opts(t.txCat) },
          { key: 'date', label: t.c.date, type: 'date', required: true },
          { key: 'note', label: t.c.notes, type: 'multiline' },
          ...(goals.items.length ? [{ key: 'goal_id', label: `🎯 ${t.fin.linkFinGoal}`, type: 'select' as const, optional: true, options: goals.items.map((g) => ({ value: g.id, label: g.title })) }] : []),
          { key: 'recurring', label: t.fin.recurring, type: 'bool' },
        ]}
        onSave={async (v) => {
          const data = { ...v, amount: Math.abs(v.amount) } as Transaction;
          if (txForm?.id) {
            await applyToGoal(txForm as Transaction, -1);
            await txs.update(txForm.id, data);
          } else await txs.create(data);
          await applyToGoal(data, 1);
        }} />

      <FormModal visible={!!goalForm} title={goalForm?.id ? t.c.edit : t.fin.addGoal} initial={{ category: 'savings', current_amount: 0, ...goalForm }} onClose={() => setGoalForm(null)}
        fields={[
          { key: 'title', label: t.c.title, required: true },
          { key: 'target_amount', label: `${t.fin.target} (${cur})`, type: 'number', required: true },
          { key: 'current_amount', label: `${t.fin.current} (${cur})`, type: 'number' },
          { key: 'deadline', label: t.fin.deadline, type: 'date' },
          { key: 'category', label: t.c.category, type: 'select', options: opts(t.finCat) },
        ]}
        onSave={async (v) => {
          const data = { ...v, current_amount: v.current_amount ?? 0, is_completed: (v.current_amount ?? 0) >= v.target_amount } as FinanceGoal;
          if (goalForm?.id) await goals.update(goalForm.id, data);
          else await goals.create(data);
        }} />

      <FormModal visible={!!salaryForm} title={salaryForm?.id ? t.c.edit : t.fin.addSalary} initial={{ type: 'monthly', date: today(), ...salaryForm }} onClose={() => setSalaryForm(null)}
        fields={[
          { key: 'title', label: t.c.title, required: true },
          { key: 'amount', label: `${t.c.amount} (${cur})`, type: 'number', required: true },
          { key: 'date', label: t.c.date, type: 'date', required: true },
          { key: 'source', label: t.fin.source },
          { key: 'type', label: t.c.type, type: 'select', options: opts(t.salaryType) },
          { key: 'note', label: t.c.notes, type: 'multiline' },
        ]}
        onSave={async (v) => { if (salaryForm?.id) await salaries.update(salaryForm.id, v); else await salaries.create(v as Salary); }} />

      <FormModal visible={!!clientForm} title={clientForm?.id ? t.c.edit : t.fin.addClient} initial={{ status: 'active', total_paid: 0, ...clientForm }} onClose={() => setClientForm(null)}
        fields={[
          { key: 'name', label: t.c.name, required: true },
          { key: 'company', label: t.fin.company },
          { key: 'email', label: t.c.email },
          { key: 'phone', label: t.c.phone },
          { key: 'status', label: t.c.status, type: 'select', options: opts(t.clientStatus) },
          { key: 'total_paid', label: `${t.fin.totalPaid} (${cur})`, type: 'number' },
          { key: 'notes', label: t.c.notes, type: 'multiline' },
        ]}
        onSave={async (v) => { if (clientForm?.id) await clients.update(clientForm.id, v); else await clients.create(v as Client); }} />

      <FormModal visible={giftForm} title={`🎁 ${t.fin.suggestGifts}`} onClose={() => setGiftForm(false)}
        fields={[
          { key: 'recipient_name', label: t.fin.recipient, required: true },
          { key: 'occasion', label: t.fin.occasion, required: true },
          { key: 'budget_min', label: `${t.fin.budgetMin} (${cur})`, type: 'number', required: true },
          { key: 'budget_max', label: `${t.fin.budgetMax} (${cur})`, type: 'number', required: true },
          { key: 'notes', label: t.c.notes, type: 'multiline' },
        ]}
        onSave={async (v) => {
          const suggestions = await ai(() => suggestGifts(v.recipient_name, v.occasion, v.budget_min, v.budget_max, lang));
          // the request is kept even when the AI is unreachable, so nothing typed is lost
          await gifts.create({ ...(v as GiftSuggestion), suggestions: suggestions ?? [], is_purchased: false });
        }} />
    </Screen>
  );
}
