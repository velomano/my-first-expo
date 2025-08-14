import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import {
  SafeAreaView,
} from 'react-native-safe-area-context';
import {
  View,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Alert,
} from 'react-native';
import { ThemedView } from '@/components/ThemedView';
import { ThemedText } from '@/components/ThemedText';
import { supabase } from '@/lib/supabase';
import { ensureTenantId } from '@/lib/resolveTenant';

type DbScan = {
  id: number;
  tenant_id: string;
  user_id: string;
  value: string;
  type: string | null;
  meta: any | null;
  created_at: string;
};

const PAGE_SIZE = 20;

const pad = (n: number) => String(n).padStart(2, '0');
const fmtLocal24 = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

const looksLikeLink = (s: string) =>
  /^[a-z][a-z0-9+\-.]*:\/\//i.test(s) ||
  /^([a-z0-9-]+\.)+[a-z]{2,}(:\d+)?(\/|$)/i.test(s) ||
  /^\d{1,3}(\.\d{1,3}){3}(:\d+)?(\/|$)/.test(s);

async function openValue(raw: string) {
  const url = raw.trim();
  const hasScheme = /^[a-z][a-z0-9+\-.]*:\/\//i.test(url);
  const isHttp = /^https?:\/\//i.test(url);
  try {
    const WebBrowser = await import('expo-web-browser');
    const Linking = await import('expo-linking');
    if (!hasScheme) { await WebBrowser.openBrowserAsync(`http://${url}`); return; }
    if (isHttp) await WebBrowser.openBrowserAsync(url);
    else await Linking.openURL(url);
  } catch {
    Alert.alert('열 수 없음', '해당 값을 여는 데 실패했어요.');
  }
}

async function copyValue(text: string) {
  try {
    const { setStringAsync } = await import('expo-clipboard');
    await setStringAsync(text);
    Alert.alert('복사됨', '값을 클립보드에 복사했어요.');
  } catch {
    Alert.alert('복사 실패', '클립보드에 복사하지 못했어요.');
  }
}

export default function HistoryScreen() {
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [items, setItems] = useState<DbScan[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const offsetRef = useRef(0);

  // 테넌트 결정
  useEffect(() => {
    (async () => {
      const t = await ensureTenantId();
      setTenantId(t);
    })();
  }, []);

  // 첫 페이지 로드
  const loadFirst = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    offsetRef.current = 0;
    const { data, error } = await supabase
      .from('scans')
      .select('id, tenant_id, user_id, value, type, meta, created_at')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .range(0, PAGE_SIZE - 1);
    if (error) { Alert.alert('조회 오류', error.message); setLoading(false); return; }
    setItems(data ?? []);
    setHasMore((data?.length ?? 0) === PAGE_SIZE);
    offsetRef.current = (data?.length ?? 0);
    setLoading(false);
  }, [tenantId]);

  // 더 불러오기
  const loadMore = useCallback(async () => {
    if (!tenantId || !hasMore || loading) return;
    const from = offsetRef.current;
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await supabase
      .from('scans')
      .select('id, tenant_id, user_id, value, type, meta, created_at')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .range(from, to);
    if (error) { return; }
    const got = data ?? [];
    setItems(prev => [...prev, ...got]);
    setHasMore(got.length === PAGE_SIZE);
    offsetRef.current += got.length;
  }, [tenantId, hasMore, loading]);

  // 풀투리프레시
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadFirst();
    setRefreshing(false);
  }, [loadFirst]);

  // 구독(INSERT/DELETE)
  useEffect(() => {
    if (!tenantId) return;
    loadFirst();

    const ch = supabase
      .channel(`scans-${tenantId}`)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'scans', filter: `tenant_id=eq.${tenantId}` },
        (payload) => {
          const row = payload.new as DbScan;
          setItems(prev => {
            // 중복 삽입 방지(id 중복)
            if (prev.find(p => p.id === row.id)) return prev;
            return [row, ...prev];
          });
        })
      .on('postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'scans', filter: `tenant_id=eq.${tenantId}` },
        (payload) => {
          const old = payload.old as { id: number };
          setItems(prev => prev.filter(p => p.id !== old.id));
        })
      .subscribe();

    return () => { supabase.removeChannel(ch); };
  }, [tenantId, loadFirst]);

  const remove = useCallback(async (row: DbScan) => {
    try {
      const { error } = await supabase
        .from('scans')
        .delete()
        .eq('id', row.id)
        .eq('tenant_id', row.tenant_id); // RLS 하에서 안전
      if (error) throw error;
    } catch (e: any) {
      Alert.alert('삭제 오류', e?.message ?? '삭제 실패');
    }
  }, []);

  const renderItem = useCallback(({ item }: { item: DbScan }) => {
    const isLink = looksLikeLink(item.value);
    return (
      <ThemedView style={styles.row}>
        <View style={{ flex: 1 }}>
          <ThemedText selectable numberOfLines={1}>{item.value}</ThemedText>
          <ThemedText style={styles.meta}>
            {fmtLocal24(item.created_at)} {item.type ? `• ${item.type}` : ''}
          </ThemedText>
        </View>
        {isLink && (
          <Pressable style={styles.smallBtn} onPress={() => openValue(item.value)}>
            <ThemedText>열기</ThemedText>
          </Pressable>
        )}
        <Pressable style={styles.smallBtn} onPress={() => copyValue(item.value)}>
          <ThemedText>복사</ThemedText>
        </Pressable>
        <Pressable style={styles.smallBtn} onPress={() => remove(item)}>
          <ThemedText>삭제</ThemedText>
        </Pressable>
      </ThemedView>
    );
  }, [remove]);

  return (
    <SafeAreaView style={{ flex: 1 }} edges={['top','left','right','bottom']}>
      <ThemedView style={{ paddingHorizontal: 20, paddingTop: 12, paddingBottom: 8 }}>
        <ThemedText type="title">스캔 이력</ThemedText>
        {tenantId && (
          <ThemedText style={{ opacity: 0.7, marginTop: 4 }}>
            Tenant: {tenantId.slice(0, 8)}…
          </ThemedText>
        )}
      </ThemedView>

      <FlatList
        data={items}
        keyExtractor={(it) => String(it.id)}
        renderItem={renderItem}
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 24 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        onEndReachedThreshold={0.2}
        onEndReached={loadMore}
        ListEmptyComponent={
          !loading ? <ThemedText style={{ paddingHorizontal: 20 }}>데이터가 없습니다.</ThemedText> : null
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  meta: { opacity: 0.7, fontSize: 12, marginTop: 2 },
  smallBtn: {
    paddingVertical: 6, paddingHorizontal: 10,
    borderRadius: 999, borderWidth: 1, alignSelf: 'center',
  },
});
