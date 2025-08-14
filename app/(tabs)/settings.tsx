// app/(tabs)/settings.tsx
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  TextInput,
  View,
  FlatList,
  RefreshControl,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Session, User } from '@supabase/supabase-js';

import { ThemedView } from '@/components/ThemedView';
import { ThemedText } from '@/components/ThemedText';
import { supabase } from '@/lib/supabase';
import { fetchMembersWithEmail, type TenantMember } from '@/lib/members';
import { ensureTenantId } from '@/lib/resolveTenant';

// ───────── util: 에러 메시지 한국어 변환 ─────────
function friendlyAuthMessage(e: { message?: string } | null | undefined) {
  const m = (e?.message ?? '').toLowerCase();
  if (m.includes('invalid login')) return '이메일 또는 비밀번호가 올바르지 않습니다.';
  if (m.includes('email not confirmed')) return '이메일 인증이 필요합니다. 메일함을 확인해 주세요.';
  if (m.includes('user already registered')) return '이미 가입된 이메일입니다.';
  if (m.includes('password should be at least')) return '비밀번호는 6자 이상이어야 해요.';
  if (m.includes('auth session missing')) return '로그인이 필요합니다. 다시 시도해 주세요.';
  return e?.message ?? '알 수 없는 오류가 발생했어요.';
}

const TENANT_KEY = 'currentTenantId';

type TenantRow = { id: string; name: string; role: 'owner' | 'admin' | 'user' | string };

export default function SettingsScreen() {
  // 세션/유저
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loadingSession, setLoadingSession] = useState(true);

  // 로그인 폼
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // 테넌트
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [tenants, setTenants] = useState<TenantRow[]>([]);
  const [loadingTenants, setLoadingTenants] = useState(false);
  const [manualTenant, setManualTenant] = useState('');

  // 멤버(이메일 포함)
  const [members, setMembers] = useState<TenantMember[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  // 1) 현재 세션 + 저장된 테넌트 불러오기, 그리고 세션 변경 구독
  useEffect(() => {
    let mounted = true;

    (async () => {
      const { data: sess } = await supabase.auth.getSession();
      if (!mounted) return;
      setSession(sess.session ?? null);
      setUser(sess.session?.user ?? null);

      const saved = await AsyncStorage.getItem(TENANT_KEY);
      if (!mounted) return;
      if (saved) setTenantId(saved);
      setLoadingSession(false);
    })();

    const { data } = supabase.auth.onAuthStateChange((_e, s) => {
      if (!mounted) return;
      setSession(s ?? null);
      setUser(s?.user ?? null);
    });

    return () => {
      mounted = false;
      data.subscription.unsubscribe();
    };
  }, []);

  // 2) 로그인된 경우 내 테넌트 목록 불러오기 (profiles/tenants join)
  useEffect(() => {
    if (!user) return;
    let alive = true;

    (async () => {
      setLoadingTenants(true);
      try {
        const { data, error } = await supabase
          .from('memberships')
          .select('tenant_id, role, tenants(name)')
          .eq('user_id', user.id);

        if (!alive) return;
        if (error) throw error;

        const rows: TenantRow[] = (data ?? []).map((r: any) => ({
          id: r.tenant_id,
          name: r.tenants?.name ?? '(이름 없음)',
          role: r.role,
        }));
        setTenants(rows);

        // 저장된 tenantId가 없고, 딱 1개면 자동 적용
        if (!tenantId && rows.length === 1) {
          await AsyncStorage.setItem(TENANT_KEY, rows[0].id);
          setTenantId(rows[0].id);
          setMsg(`테넌트 자동 선택: ${rows[0].name}`);
        }
      } catch (e: any) {
        setMsg(e?.message ?? '테넌트 목록을 불러오지 못했어요.');
      } finally {
        setLoadingTenants(false);
      }
    })();

    return () => { alive = false; };
  }, [user]);

  // 3) ensureTenantId()로 보정 (로그인/초기 진입 시)
  useEffect(() => {
    (async () => {
      try {
        const t = await ensureTenantId();
        if (t) {
          setTenantId(t);
          await AsyncStorage.setItem(TENANT_KEY, t);
        }
      } catch {
        // 없으면 조용히 패스 (수동 선택 가능)
      }
    })();
  }, []);

  // 4) RPC로 멤버 목록 로드
  const loadMembers = useCallback(async () => {
    if (!tenantId) return;
    try {
      const rows = await fetchMembersWithEmail(tenantId);
      setMembers(rows);
    } catch (e: any) {
      Alert.alert('멤버 조회 실패', friendlyAuthMessage(e));
    }
  }, [tenantId]);

  useEffect(() => { loadMembers(); }, [loadMembers]);

  // ───────── 인증 액션 ─────────
  const handleSignIn = async () => {
    setMsg(null);
    if (!email || !pw) return setMsg('이메일과 비밀번호를 입력해 주세요.');
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password: pw });
    setBusy(false);
    if (error) return setMsg(friendlyAuthMessage(error));
    setEmail(''); setPw('');
  };

  const handleSignUp = async () => {
    setMsg(null);
    if (!email || !pw) return setMsg('이메일과 비밀번호를 입력해 주세요.');
    if (pw.length < 6) return setMsg('비밀번호는 6자 이상이어야 해요.');
    setBusy(true);
    const { error } = await supabase.auth.signUp({ email, password: pw });
    setBusy(false);
    if (error) return setMsg(friendlyAuthMessage(error));
    setMsg('가입 완료! (이메일 인증 설정이 켜져 있다면 메일 확인 필요)');
  };

  const handleSignOut = async () => {
    setBusy(true);
    const { error } = await supabase.auth.signOut();
    setBusy(false);
    if (error) return setMsg(friendlyAuthMessage(error));
    setMsg('로그아웃 되었습니다.');
    setEmail(''); setPw('');
    setMembers([]);
  };

  // ───────── 테넌트 액션 ─────────
  const applyTenant = async (id: string) => {
    await AsyncStorage.setItem(TENANT_KEY, id);
    setTenantId(id);
    const t = tenants.find(x => x.id === id);
    setMsg(`테넌트 적용: ${t?.name ?? id}`);
    loadMembers();
  };

  const applyManualTenant = async () => {
    if (!manualTenant.trim()) return setMsg('테넌트 ID를 입력하세요.');
    const id = manualTenant.trim();
    await AsyncStorage.setItem(TENANT_KEY, id);
    setTenantId(id);
    setMsg('수동 테넌트 ID가 저장되었습니다.');
    setManualTenant('');
    loadMembers();
  };

  // ───────── UI ─────────
  if (loadingSession) {
    return (
      <SafeAreaView style={s.safe} edges={['top', 'left', 'right', 'bottom']}>
        <ThemedView style={[s.box, { alignItems: 'center', justifyContent: 'center' }]}>
          <ActivityIndicator />
          <ThemedText style={{ marginTop: 8 }}>세션 확인 중…</ThemedText>
        </ThemedView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.safe} edges={['top', 'left', 'right', 'bottom']}>
      <ThemedView style={s.box}>
        <ThemedText type="title">설정</ThemedText>

        {/* 로그인 섹션 */}
        {session ? (
          <>
            <ThemedText style={{ marginTop: 6 }}>
              로그인됨: {session.user.email ?? session.user.id}
            </ThemedText>
            <View style={s.row}>
              <Pressable style={s.btn} disabled={busy} onPress={handleSignOut}>
                <ThemedText type="defaultSemiBold">{busy ? '처리 중…' : '로그아웃'}</ThemedText>
              </Pressable>
            </View>
          </>
        ) : (
          <>
            <ThemedText style={{ marginTop: 6, opacity: 0.7 }}>로그아웃 상태</ThemedText>
            <TextInput
              style={s.input}
              placeholder="이메일"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              value={email}
              onChangeText={setEmail}
              editable={!busy}
            />
            <TextInput
              style={s.input}
              placeholder="비밀번호(6자 이상)"
              secureTextEntry
              value={pw}
              onChangeText={setPw}
              editable={!busy}
            />
            <View style={s.row}>
              <Pressable style={s.btn} disabled={busy} onPress={handleSignIn}>
                <ThemedText type="defaultSemiBold">{busy ? '로그인 중…' : '로그인'}</ThemedText>
              </Pressable>
              <Pressable style={s.btn} disabled={busy} onPress={handleSignUp}>
                <ThemedText type="defaultSemiBold">{busy ? '처리 중…' : '회원가입'}</ThemedText>
              </Pressable>
            </View>
          </>
        )}

        {/* 테넌트 섹션 (로그인된 경우만) */}
        {user && (
          <View style={{ marginTop: 18, gap: 10 }}>
            <ThemedText type="subtitle">내 테넌트</ThemedText>
            <ThemedText style={{ opacity: 0.7 }}>
              현재 적용: {tenantId ? `${tenantId.slice(0, 8)}…` : '미설정'}
            </ThemedText>

            {loadingTenants ? (
              <View style={{ marginTop: 8 }}>
                <ActivityIndicator />
              </View>
            ) : tenants.length > 0 ? (
              <View style={{ gap: 8 }}>
                {tenants.map(t => (
                  <Pressable
                    key={t.id}
                    style={[
                      s.btn,
                      tenantId === t.id && { borderColor: '#888', backgroundColor: 'transparent' },
                    ]}
                    onPress={() => applyTenant(t.id)}
                  >
                    <ThemedText>
                      {t.name} ({t.role}) — {t.id.slice(0, 8)}…
                    </ThemedText>
                  </Pressable>
                ))}
              </View>
            ) : (
              <ThemedText>연결된 테넌트가 없습니다. (관리자에게 요청하세요)</ThemedText>
            )}

            {/* 수동 입력(옵션) */}
            <View style={{ marginTop: 8, gap: 8 }}>
              <ThemedText style={{ opacity: 0.8 }}>수동으로 테넌트 ID 입력</ThemedText>
              <TextInput
                style={s.input}
                placeholder="예: a17320fa-d8b3-46af-a339-b3bb81b4dd3c"
                autoCapitalize="none"
                value={manualTenant}
                onChangeText={setManualTenant}
              />
              <Pressable style={s.btn} onPress={applyManualTenant}>
                <ThemedText type="defaultSemiBold">수동 저장</ThemedText>
              </Pressable>
            </View>
          </View>
        )}

        {/* 멤버 목록 (이메일 포함) */}
        {tenantId && (
          <>
            <ThemedText type="subtitle" style={{ marginTop: 16 }}>테넌트 멤버</ThemedText>
            <FlatList
              data={members}
              keyExtractor={(m) => `${m.user_id}`}
              renderItem={({ item }) => (
                <ThemedView style={s.listRow}>
                  <View style={{ flex: 1 }}>
                    <ThemedText selectable>{item.email ?? '(이메일 없음)'}</ThemedText>
                    <ThemedText style={s.meta}>
                      role: {item.role ?? '-'} • joined: {new Date(item.created_at).toLocaleString()}
                    </ThemedText>
                  </View>
                </ThemedView>
              )}
              refreshControl={
                <RefreshControl
                  refreshing={refreshing}
                  onRefresh={async () => {
                    setRefreshing(true);
                    await loadMembers();
                    setRefreshing(false);
                  }}
                />
              }
              contentContainerStyle={{ paddingBottom: 24 }}
            />
          </>
        )}

        {!!msg && <ThemedText style={{ marginTop: 10 }}>메시지: {msg}</ThemedText>}
      </ThemedView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1 },
  box: { flex: 1, padding: 20, gap: 10 },
  input: {
    borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10,
  },
  row: { flexDirection: 'row', gap: 12, marginTop: 12, flexWrap: 'wrap' },
  btn: { borderWidth: 1, borderRadius: 8, paddingVertical: 10, paddingHorizontal: 16, alignSelf: 'flex-start' },
  listRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  meta: { opacity: 0.7, fontSize: 12, marginTop: 2 },
});
