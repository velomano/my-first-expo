import { useCallback, useEffect, useState } from 'react';
import { Alert, FlatList, Pressable, RefreshControl, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { bus } from '@/lib/bus';
import { supabase } from '@/lib/supabase';

type Row = {
  id: number;
  client_ref: string;
  tenant_id: string | null;
  user_id: string;
  type: 'qrcode' | 'barcode';
  value: string;
  created_at: string;
  meta: any;
};

const PAGE = 50;

export default function HistoryScreen() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const loadInitial = useCallback(async () => {
    setLoading(true);
    try {
      const session = (await supabase.auth.getSession()).data.session;
      const uid = session?.user?.id;
      if (!uid) return;

      const { data, error } = await supabase
        .from('scans')
        .select('id, client_ref, tenant_id, user_id, type, value, created_at, meta')
        .eq('user_id', uid)
        .order('created_at', { ascending: false })
        .limit(PAGE);

      if (error) throw error;
      setRows(data ?? []);
    } catch (e: any) {
      Alert.alert('로드 실패', e?.message ?? '이력 불러오기에 실패했습니다.');
    } finally {
      setLoading(false);
    }
  }, []);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadInitial();
    setRefreshing(false);
  }, [loadInitial]);

  // 최초 로드
  useEffect(() => {
    loadInitial();
  }, [loadInitial]);

  // ✅ 이벤트 버스: INSERT 즉시 반영
  useEffect(() => {
    const off = bus.on<Row>('scan:insert', (r) => {
      setRows(prev => {
        if (prev.some(x => x.id === r.id)) return prev;
        return [r, ...prev].slice(0, PAGE);
      });
    });
    return off;
  }, []);

  // ✅ 이벤트 버스: DELETE 즉시 반영(이 화면에서 삭제할 때)
  useEffect(() => {
    const off = bus.on<number>('scan:delete', (id) => {
      setRows(prev => prev.filter(x => x.id !== id));
    });
    return off;
  }, []);

  // ✅ Supabase Realtime (백업용, 서버에서 발생한 변경도 반영)
  useEffect(() => {
    let channel: ReturnType<typeof supabase.channel> | null = null;

    (async () => {
      const session = (await supabase.auth.getSession()).data.session;
      const uid = session?.user?.id;
      if (!uid) return;

      channel = supabase
        .channel('scans-realtime')
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'scans', filter: `user_id=eq.${uid}` },
          (payload) => {
            if (payload.eventType === 'INSERT') {
              const r = payload.new as Row;
              setRows(prev => (prev.some(x => x.id === r.id) ? prev : [r, ...prev].slice(0, PAGE)));
            } else if (payload.eventType === 'UPDATE') {
              const r = payload.new as Row;
              setRows(prev => prev.map(x => (x.id === r.id ? r : x)));
            } else if (payload.eventType === 'DELETE') {
              const r = payload.old as Row;
              setRows(prev => prev.filter(x => x.id !== (r.id as any)));
            }
          }
        )
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') {
            // 서버 상태와 맞추기 위해 최초 한 번 동기화(선택)
            loadInitial();
          }
        });
    })();

    return () => {
      if (channel) supabase.removeChannel(channel);
    };
  }, [loadInitial]);

  const renderItem = ({ item }: { item: Row }) => (
    <Pressable
      style={styles.row}
      onLongPress={async () => {
        try {
          const { error } = await supabase.from('scans').delete().eq('id', item.id);
          if (error) throw error;
          // 즉시 반영
          bus.emit('scan:delete', item.id);
        } catch (e: any) {
          Alert.alert('삭제 실패', e?.message ?? '삭제 중 오류가 발생했습니다.');
        }
      }}
    >
      <ThemedView style={{ flex: 1 }}>
        <ThemedText selectable numberOfLines={1}>{item.value}</ThemedText>
        <ThemedText style={styles.meta}>
          {new Date(item.created_at).toLocaleString()} • {item.type}
        </ThemedText>
      </ThemedView>
    </Pressable>
  );

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <ThemedView style={styles.header}>
        <ThemedText type="title">스캔 이력</ThemedText>
        <ThemedText style={styles.sub}>실시간 업데이트</ThemedText>
      </ThemedView>

      <FlatList
        data={rows}
        keyExtractor={(item) => String(item.id)}
        renderItem={renderItem}
        contentContainerStyle={{ padding: 16 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        onEndReachedThreshold={0.2}
        onEndReached={async () => {
          if (rows.length < PAGE) return;
          try {
            const last = rows[rows.length - 1]?.created_at;
            if (!last) return;
            const session = (await supabase.auth.getSession()).data.session;
            const uid = session?.user?.id;
            if (!uid) return;

            const { data, error } = await supabase
              .from('scans')
              .select('id, client_ref, tenant_id, user_id, type, value, created_at, meta')
              .eq('user_id', uid)
              .lt('created_at', last)
              .order('created_at', { ascending: false })
              .limit(PAGE);

            if (error) throw error;
            setRows(prev => [...prev, ...(data ?? [])]);
          } catch {}
        }}
        ListEmptyComponent={
          !loading ? (
            <ThemedText style={{ textAlign: 'center', marginTop: 24 }}>
              아직 데이터가 없어요.
            </ThemedText>
          ) : null
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8 },
  sub: { opacity: 0.7, marginTop: 4 },
  row: {
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  meta: { opacity: 0.7, fontSize: 12, marginTop: 2 },
});
