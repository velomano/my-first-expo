// lib/sync.ts — 안정화된 동기화(조용한 로그, 잔재 자동정리, 안전한 insert)

import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { AppState } from 'react-native';
import { supabase } from './supabase';

/* ========== 타입 ========== */
export type LocalScan = {
  localId: string;
  serverId?: string | null;
  userId?: string | null;
  tenantId?: string | null;
  createdAt: string;                 // ISO
  codeType: 'qrcode' | 'barcode';
  payload: string;
  clientRef: string;                 // 멱등 키
  meta?: Record<string, any>;
  synced: boolean;
};

/* ========== 키/유틸 ========== */
const K_HISTORY        = 'history:v1';
const K_OUTBOX         = 'outbox:v1';
const K_LASTPULLED_AT  = 'lastPulledAt:v1';
const K_LEGACY_CLEANED = 'SYNC_CLEANED_v1'; // 1번만 실행 플래그

const LEGACY_KEYS = ['PENDING_QUEUE','SYNC_LOCK','SYNC_IN_PROGRESS','SYNC_QUARANTINE_LAST'];

const nowIso = () => new Date().toISOString();

async function readJson<T>(key: string, fallback: T): Promise<T> {
  const raw = await AsyncStorage.getItem(key);
  if (!raw) return fallback;
  try { return JSON.parse(raw) as T; } catch { return fallback; }
}
async function writeJson<T>(key: string, value: T) {
  await AsyncStorage.setItem(key, JSON.stringify(value));
}

/* ========== 1회용 잔재 청소 ========== */
async function purgeLegacyArtifactsOnce() {
  const done = await AsyncStorage.getItem(K_LEGACY_CLEANED);
  if (done) return;
  await AsyncStorage.multiRemove(LEGACY_KEYS);
  await AsyncStorage.setItem(K_LEGACY_CLEANED, '1');
  console.log('[SYNC] artifacts cleared');
}

/* ========== 보조: tenant_id 확보 ========== */
async function ensureTenantId(userId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('memberships')
    .select('tenant_id')
    .eq('user_id', userId)
    .limit(1)
    .maybeSingle();
  if (error) return null;
  return data?.tenant_id ?? null;
}

/* ========== PUSH: outbox → 서버 ========== */
export async function pushOutbox() {
  const session = (await supabase.auth.getSession()).data.session;
  if (!session) return { pushed: 0, reason: 'no-session' as const };
  const userId = session.user.id;

  const outbox = (await readJson<LocalScan[]>(K_OUTBOX, [] as LocalScan[])).reverse(); // FIFO
  if (outbox.length === 0) return { pushed: 0 };

  let pushed = 0;
  const failures: LocalScan[] = [];

  for (const item of outbox) {
    try {
      // tenantId가 비어있으면 memberships에서 보강
      const tenantId = item.tenantId ?? (await ensureTenantId(userId));

      const row = {
        user_id: userId,
        tenant_id: tenantId, // 테이블이 NOT NULL이면 ensureTenantId가 null이면 실패할 수 있음
        created_at: item.createdAt,
        type: item.codeType,
        value: item.payload,
        client_ref: item.clientRef,
        meta: item.meta ?? null,
      };

      // 안전한 insert: 유니크 위반(23505)이면 이미 반영된 것으로 간주
      const { error } = await supabase.from('scans').insert(row);
      if (error) {
        const code = (error as any)?.code;
        const msg  = (error as any)?.message || '';
        if (code === '23505' || /duplicate key/i.test(msg)) {
          // 이미 존재 → 성공 취급
        } else {
          failures.push(item);
          continue;
        }
      }

      // 히스토리 동기화 표시
      const hist = await readJson<LocalScan[]>(K_HISTORY, [] as LocalScan[]);
      const idx = hist.findIndex(h => h.localId === item.localId);
      if (idx >= 0) {
        hist[idx].synced = true;
        hist[idx].userId = userId;
        await writeJson(K_HISTORY, hist);
      }

      pushed++;
    } catch {
      failures.push(item);
    }
  }

  await writeJson(K_OUTBOX, failures.reverse());
  return { pushed, failed: failures.length };
}

/* ========== PULL: 서버 → 로컬 병합 ========== */
export async function pullServer() {
  const session = (await supabase.auth.getSession()).data.session;
  if (!session) return { pulled: 0, reason: 'no-session' as const };

  const since = (await AsyncStorage.getItem(K_LASTPULLED_AT)) ?? '1970-01-01T00:00:00.000Z';
  const { data, error } = await supabase
    .from('scans')
    .select('id, user_id, tenant_id, created_at, type, value, meta')
    .gte('created_at', since)
    .order('created_at', { ascending: false });

  if (error) return { pulled: 0, reason: 'pull-error' as const };

  const history = await readJson<LocalScan[]>(K_HISTORY, [] as LocalScan[]);
  const byServerId = new Set(history.filter(h => h.serverId).map(h => h.serverId as string));

  let added = 0;
  for (const row of data ?? []) {
    const idStr = String(row.id);
    if (byServerId.has(idStr)) continue;

    history.push({
      localId: `srv-${idStr}`,
      serverId: idStr,
      userId: row.user_id,
      tenantId: row.tenant_id,
      createdAt: row.created_at,
      codeType: (row.type as 'qrcode' | 'barcode') ?? 'barcode',
      payload: row.value,
      clientRef: `srv-${idStr}`,
      meta: row.meta ?? undefined,
      synced: true,
    });
    added++;
  }

  // 최신순 정렬 & 저장
  history.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  await writeJson(K_HISTORY, history);
  await AsyncStorage.setItem(K_LASTPULLED_AT, nowIso());

  return { pulled: added };
}

/* ========== 전체 동기화(조용한 로그) ========== */
export async function syncAll() {
  await purgeLegacyArtifactsOnce(); // 첫 1회만 실행됨

  try {
    const push = await pushOutbox();
    const pull = await pullServer();
    // 필요 시 디버그: console.log('[SYNC] summary', push, pull);
    return { push, pull };
  } catch (e) {
    // 에러 삼켜서 UI 방해 X
    return { push: { pushed: 0 }, pull: { pulled: 0 }, error: true };
  }
}

/* ========== 리스너 (옵션) ========== */
export function attachSyncListeners() {
  // 조용히 한 번만 붙였다가, AppState/네트워크 변화 시 syncAll 실행
  // (불필요하면 _layout.tsx 에서 호출하지 않아도 됨)
  const netUnsub = NetInfo.addEventListener(state => {
    if (state.isConnected && state.isInternetReachable) {
      syncAll().catch(() => {});
    }
  });

  const appSub = AppState.addEventListener('change', s => {
    if (s === 'active') {
      syncAll().catch(() => {});
    }
  });

  return () => {
    netUnsub();
    appSub.remove();
  };
}

/* (디버깅용) 외부에서 키 접근 */
export const __SYNC_KEYS__ = { K_HISTORY, K_OUTBOX, K_LASTPULLED_AT, K_LEGACY_CLEANED };
