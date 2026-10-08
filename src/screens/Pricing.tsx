import * as Linking from 'expo-linking';
import React, { useState } from 'react';

import { useLang, useTheme } from '@/ctx/Lang';
import { PRICES, STRIPE_LINKS } from '@/lib/config';
import { useKV } from '@/lib/db';
import { Badge, Btn, Card, Row, Screen, Txt, notice } from '@/ui/kit';

type Plan = 'free' | 'monthly' | 'yearly';

export default function Pricing() {
  const c = useTheme();
  const { t } = useLang();
  const [plan, setPlan] = useKV<Plan>('plan', 'free');
  const [paying, setPaying] = useState<Plan | null>(null);
  const plans: { key: Plan; price: string; features: string[] }[] = [
    { key: 'free', price: `0 ${t.c.currency}`, features: t.pricing.featFree },
    { key: 'monthly', price: `${PRICES.monthly} ${t.c.currency} ${t.pricing.perMonth}`, features: t.pricing.featMonthly },
    { key: 'yearly', price: `${PRICES.yearly} ${t.c.currency} ${t.pricing.perYear}`, features: t.pricing.featYearly },
  ];

  // Checkout happens on Stripe's hosted page; with no server to confirm it, the plan is activated by the user afterwards.
  const subscribe = async (key: Exclude<Plan, 'free'>) => {
    if (!STRIPE_LINKS[key]) return notice(t.pricing.notConfigured);
    await Linking.openURL(STRIPE_LINKS[key]);
    setPaying(key);
  };

  return (
    <Screen>
      {plans.map((p) => (
        <Card key={p.key} style={{ borderColor: plan === p.key ? c.primary : c.border, borderWidth: plan === p.key ? 2 : 1 }}>
          <Row>
            <Txt v="h" style={{ flex: 1 }}>{t.pricing[p.key]}</Txt>
            {plan === p.key ? <Badge text={t.pricing.current} color={c.primary} /> : null}
          </Row>
          <Txt v="sub">{p.price}</Txt>
          {p.features.map((f) => <Txt key={f} v="muted">✓ {f}</Txt>)}
          {p.key === 'free'
            ? plan !== 'free' ? <Btn kind="ghost" title={t.pricing.free} onPress={() => setPlan('free')} /> : null
            : plan !== p.key ? <Btn title={`💳 ${t.pricing.choose}`} onPress={() => subscribe(p.key as 'monthly' | 'yearly')} /> : null}
          {paying === p.key && plan !== p.key ? <Btn kind="ghost" title={t.pricing.activate} onPress={() => { setPlan(p.key); setPaying(null); }} /> : null}
        </Card>
      ))}
    </Screen>
  );
}
