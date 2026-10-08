import React, { useState } from 'react';

import { useAuth } from '@/ctx/Auth';
import { useLang, useTheme } from '@/ctx/Lang';
import { INVITE_LINK } from '@/lib/config';
import { today } from '@/lib/dates';
import { useKV } from '@/lib/db';
import { SendEmail } from '@/lib/integrations';
import { Badge, Btn, Card, Empty, IconBtn, Input, Row, Screen, Section, Txt, notice } from '@/ui/kit';

type Invitation = { email: string; role: 'user'; date: string; status: 'sent' | 'joined' };
const NONE: Invitation[] = [];

export default function Invite() {
  const c = useTheme();
  const { t } = useLang();
  const { user } = useAuth();
  const [invites, setInvites] = useKV<Invitation[]>('invites', NONE);
  const [email, setEmail] = useState('');

  if (user?.role !== 'admin')
    return (
      <Screen>
        <Empty icon="🔒" text={t.invite.notAllowed} />
      </Screen>
    );

  const send = async () => {
    const to = email.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(to)) return notice(t.auth.error);
    const link = `${INVITE_LINK}?by=${encodeURIComponent(user.name)}`;
    await SendEmail({ to, subject: t.invite.subject, body: `${t.invite.body}\n${link}` });
    await setInvites([{ email: to, role: 'user', date: today(), status: 'sent' }, ...invites.filter((i) => i.email !== to)]);
    setEmail('');
  };

  return (
    <Screen>
      <Card>
        <Input label={t.invite.emailPh} value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" />
        <Txt v="small">{t.invite.role}: {t.auth.roleUser} · {t.motiv.mailNote}</Txt>
        <Btn title={`✉️ ${t.invite.send}`} onPress={send} disabled={!email.trim()} />
      </Card>
      <Section title={t.invite.list}>
        {!invites.length ? <Empty icon="👥" text={t.invite.empty} /> : invites.map((i) => (
          <Card key={i.email}>
            <Row>
              <Txt style={{ flex: 1, fontWeight: '600' }}>{i.email}</Txt>
              <Badge text={i.status === 'joined' ? `✓ ${t.invite.joined}` : t.invite.sent} color={i.status === 'joined' ? c.success : c.warn} />
            </Row>
            <Row>
              <Txt v="small" style={{ flex: 1 }}>{i.date} · {t.auth.roleUser}</Txt>
              {i.status === 'sent' ? <Btn small kind="ghost" title={t.invite.markJoined} onPress={() => setInvites(invites.map((x) => (x.email === i.email ? { ...x, status: 'joined' } : x)))} /> : null}
              <IconBtn icon="🗑" label={t.c.delete} onPress={() => setInvites(invites.filter((x) => x.email !== i.email))} />
            </Row>
          </Card>
        ))}
      </Section>
    </Screen>
  );
}
