import { useEffect, useState } from 'react';
import { StyleSheet, Pressable, Alert, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ThemedView } from '@/components/ThemedView';
import { ThemedText } from '@/components/ThemedText';
import { supabase } from '@/lib/supabase';
import { getTenantId } from '@/lib/tenantStorage';
import { ensureTenantId } from '@/lib/resolveTenant';

export default function HomeScreen() {
  const [userId, setUserId] = useState<string | null>(null);
  const [status, setStatus] = useState('대기 중');

  // 세션: 첫 진입 + 이후 변경 모두 반영
  useEffect(() => {
    let mounted = true;

    // 1) 현재 세션 일단 읽기
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setUserId(data.session?.user?.id ?? null);
    });

    // 2) INITIAL_SESSION / SIGNED_IN / TOKEN_REFRESHED 등 변화 구독
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!mounted) return;
      setUserId(session?.user?.id ?? null);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  // SELECT 테스트
  const onTestSelect = async () => {
    try {
      setStatus('SELECT 중…');
      const { data, error } = await supabase
        .from('scans')
        .select('id, tenant_id, created_at')
        .limit(1);

      if (error) throw new Error(error.message);
      setStatus(`연결 OK • rows: ${data?.length ?? 0}`);
      console.log('SELECT scans ->', data);
    } catch (e: any) {
      setStatus(`에러: ${e.message ?? '실패'}`);
      console.log('SELECT error ->', e);
      Alert.alert('조회 오류', e.message ?? '실패');
    }
  };

  // INSERT 테스트
const onTestInsert = async () => {
  try {
    const tenantId = await ensureTenantId();  // <-- 비어있으면 자동 결정 후 저장
    setStatus('INSERT 중…');
    const { error } = await supabase.from('scans').insert([{
      tenant_id: tenantId,
      value: `test-${Date.now()}`,
      type: 'qrcode',
      meta: { source: 'home' },
    }]);
    if (error) throw new Error(error.message);
    setStatus('INSERT OK');
    Alert.alert('성공', '샘플 스캔 1건 저장됨');
  } catch (e: any) {
    setStatus(`에러: ${e.message ?? '실패'}`);
    Alert.alert('저장 오류', e.message ?? '실패');
  }
};

// 최근 5건 조회
const onLoadRecent = async () => {
  try {
    const tenantId = await ensureTenantId();  // <-- 자동 보정
    setStatus('최근 5건 조회 중…');
    const { data, error } = await supabase
      .from('scans')
      .select('id, value, type, created_at')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .limit(5);
    if (error) throw new Error(error.message);
    setStatus(`조회 OK • ${data?.length ?? 0}건`);
    console.log('RECENT scans ->', data);
  } catch (e: any) {
    setStatus(`에러: ${e.message ?? '실패'}`);
    Alert.alert('조회 오류', e.message ?? '실패');
  }
 };


  return (
    <SafeAreaView style={{ flex: 1 }}>
      <ThemedView style={styles.container}>
        <ThemedText type="title">홈</ThemedText>

        <View style={styles.panel}>
          <ThemedText type="subtitle">세션</ThemedText>
          <ThemedText>{userId ? `로그인됨: ${userId}` : '로그인 안됨'}</ThemedText>
        </View>

        <Pressable onPress={onTestSelect} style={styles.button}>
          <ThemedText type="defaultSemiBold">SELECT 테스트 (scans)</ThemedText>
        </Pressable>

        <Pressable onPress={onTestInsert} style={styles.button}>
          <ThemedText type="defaultSemiBold">INSERT 테스트 (샘플 1건 저장)</ThemedText>
        </Pressable>

        <Pressable onPress={onLoadRecent} style={styles.button}>
          <ThemedText type="defaultSemiBold">최근 5건 조회 (tenant 필터)</ThemedText>
        </Pressable>

        <View style={styles.panel}>
          <ThemedText type="subtitle">상태</ThemedText>
          <ThemedText>{status}</ThemedText>
        </View>
      </ThemedView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: 20, paddingTop: 12, gap: 12 },
  button: { padding: 12, borderRadius: 8, borderWidth: 1 },
  panel: { padding: 12, borderWidth: 1, borderRadius: 8 },
});
