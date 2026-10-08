import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, PanResponder, Text, View, ViewStyle, StyleProp } from 'react-native';

import { useLang, useTheme } from '@/ctx/Lang';

type Zone = { id: string; ref: React.RefObject<View | null> };
type DragCtx = { zones: React.MutableRefObject<Map<string, Zone>>; setDragging: (v: boolean) => void; dragging: boolean };
const Ctx = createContext<DragCtx | null>(null);

// Wrap a screen in this to enable dragging; a delete zone slides in at the bottom while something is held.
export function DragArea({ children, withDelete = true }: { children: React.ReactNode; withDelete?: boolean }) {
  const zones = useRef(new Map<string, Zone>());
  const [dragging, setDragging] = useState(false);
  const value = useMemo(() => ({ zones, setDragging, dragging }), [dragging]);
  return (
    <Ctx.Provider value={value}>
      <View style={{ flex: 1 }}>
        {children}
        {withDelete && dragging ? <DeleteZone /> : null}
      </View>
    </Ctx.Provider>
  );
}

function DeleteZone() {
  const c = useTheme();
  const { t } = useLang();
  const ref = useDropZone('delete');
  return (
    <View ref={ref} collapsable={false} style={{ position: 'absolute', left: 16, right: 16, bottom: 16, height: 84, borderRadius: 14, borderWidth: 2, borderStyle: 'dashed', borderColor: c.danger, backgroundColor: c.card, alignItems: 'center', justifyContent: 'center', opacity: 0.95 }}>
      <Text style={{ color: c.danger, fontWeight: '700' }}>{t.c.dropToDelete}</Text>
    </View>
  );
}

export function useDropZone(id: string) {
  const ctx = useContext(Ctx);
  const ref = useRef<View>(null);
  useEffect(() => {
    if (!ctx) return;
    const map = ctx.zones.current;
    map.set(id, { id, ref });
    return () => {
      map.delete(id);
    };
  }, [ctx, id]);
  return ref;
}

export function DropZone({ id, children, style }: { id: string; children?: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const ref = useDropZone(id);
  return <View ref={ref} collapsable={false} style={style}>{children}</View>;
}

const measure = (z: Zone) =>
  new Promise<{ id: string; x: number; y: number; w: number; h: number } | null>((res) => {
    const node = z.ref.current;
    if (!node) return res(null);
    node.measureInWindow((x, y, w, h) => res({ id: z.id, x, y, w, h }));
  });

// The item follows the finger from its ⠿ handle; on release the zone under the finger receives it.
export function Draggable({ children, onDrop, selfZone, style }: { children: React.ReactNode; onDrop: (zoneId: string) => void; selfZone?: string; style?: StyleProp<ViewStyle> }) {
  const ctx = useContext(Ctx);
  const c = useTheme();
  const { t } = useLang();
  const pos = useRef(new Animated.ValueXY()).current;
  const [held, setHeld] = useState(false);
  const live = useRef({ onDrop, selfZone, ctx });
  live.current = { onDrop, selfZone, ctx };

  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        setHeld(true);
        live.current.ctx?.setDragging(true);
      },
      onPanResponderMove: Animated.event([null, { dx: pos.x, dy: pos.y }], { useNativeDriver: false }),
      onPanResponderRelease: async (_e, g) => {
        const { ctx: cx, onDrop: drop, selfZone: self } = live.current;
        const rects = cx ? await Promise.all([...cx.zones.current.values()].map(measure)) : [];
        // the delete zone wins over whatever lies beneath it
        const hits = rects.filter((r) => r && r.id !== self && g.moveX >= r.x && g.moveX <= r.x + r.w && g.moveY >= r.y && g.moveY <= r.y + r.h);
        const hit = hits.find((r) => r!.id === 'delete') ?? hits.find((r) => r!.id.startsWith('item:')) ?? hits[0];
        setHeld(false);
        cx?.setDragging(false);
        pos.setValue({ x: 0, y: 0 });
        if (hit && (Math.abs(g.dx) > 6 || Math.abs(g.dy) > 6)) drop(hit.id);
      },
      onPanResponderTerminate: () => {
        setHeld(false);
        live.current.ctx?.setDragging(false);
        pos.setValue({ x: 0, y: 0 });
      },
    }),
  ).current;

  return (
    <Animated.View style={[style, { transform: pos.getTranslateTransform(), zIndex: held ? 999 : 0, elevation: held ? 12 : 0, opacity: held ? 0.9 : 1 }]}>
      <View style={{ flexDirection: 'row', alignItems: 'stretch' }}>
        <View {...responder.panHandlers} accessibilityLabel={t.c.move} style={{ justifyContent: 'center', paddingHorizontal: 6 }}>
          <Text style={{ color: c.muted, fontSize: 18 }}>⠿</Text>
        </View>
        <View style={{ flex: 1 }}>{children}</View>
      </View>
    </Animated.View>
  );
}
