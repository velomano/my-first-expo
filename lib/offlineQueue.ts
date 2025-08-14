// lib/offlineQueue.ts  — 개발용/임시 스텁(완전 비활성화)
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEYS = ['PENDING_QUEUE', 'SYNC_LOCK', 'SYNC_IN_PROGRESS', 'SYNC_QUARANTINE_LAST'];

// 어디서 호출하든, “동기화 비활성화”만 알리고 바로 끝내기
export function watchNetworkFlush() {
  console.log('[SYNC] disabled');
  return () => {}; // detach noop
}

// 혹시 남아있는 코드가 enqueueScan을 호출해도 아무 일도 안 하도록
export async function enqueueScan(_: any) {
  // 큐에 쌓지 않음 (완전 무시)
  return;
}

// 다른 곳에서 flush를 호출해도 무시
export async function flushOnce() {
  return;
}

// (선택) 앱이 부팅할 때 찌꺼기 있으면 한번 지움
export async function purgeSyncArtifactsOnce() {
  try {
    await AsyncStorage.multiRemove(KEYS);
    console.log('[SYNC] artifacts cleared');
  } catch {}
}
