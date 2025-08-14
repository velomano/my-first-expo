// app/(tabs)/scan.tsx
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useIsFocused } from '@react-navigation/native';
import { Camera, CameraView, type BarcodeScanningResult } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Dimensions, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import 'react-native-get-random-values';
import { v4 as uuid } from 'uuid';

import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { supabase } from '@/lib/supabase';

const { width, height } = Dimensions.get('window');

type ScanItem = { id: number; value: string; type?: string; ts: number };
const HISTORY_KEY = 'scanHistory.v1';

// 동기화 잔재 정리(첫 실행 한 번)
async function purgeLegacySyncArtifacts() {
  await AsyncStorage.multiRemove([
    'PENDING_QUEUE',
    'SYNC_LOCK',
    'SYNC_IN_PROGRESS',
    'SYNC_QUARANTINE_LAST',
  ]);
  await AsyncStorage.setItem('SYNC_CLEANED_v1', '1');
  console.log('[sync] legacy artifacts purged');
}

const pad = (n: number) => String(n).padStart(2, '0');
const fmtLocal24 = (ts: number) => {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} `
       + `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

export default function ScanScreen() {
  const isFocused = useIsFocused();
  const [hasPermission, setHasPermission] = useState<null | boolean>(null);

  const [lastValue, setLastValue] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<'idle'|'saving'|'ok'|'error'>('idle');
  const [history, setHistory] = useState<ScanItem[]>([]);

  const lastScannedAt = useRef(0);
  const lastDataRef = useRef<string | null>(null);

  // 카메라 권한
  useEffect(() => {
    (async () => {
      const { status } = await Camera.requestCameraPermissionsAsync();
      setHasPermission(status === 'granted');
    })();
  }, []);

  // 동기화 잔재 자동 정리(첫 실행 한 번만)
  useEffect(() => {
    (async () => {
      const done = await AsyncStorage.getItem('SYNC_CLEANED_v1');
      if (!done) {
        await purgeLegacySyncArtifacts();
      }
    })();
  }, []);

  // 스캔 이력 로드/저장
  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(HISTORY_KEY);
        if (raw) {
          const parsed: ScanItem[] = JSON.parse(raw);
          setHistory(Array.isArray(parsed) ? parsed : []);
        }
      } catch {}
    })();
  }, []);
  useEffect(() => {
    (async () => {
      try {
        await AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(history));
      } catch {}
    })();
  }, [history]);

  // 스캔 즉시 DB에 insert
  const saveScanDirect = useCallback(async (value: string, symbology?: string) => {
    try {
      setSaveStatus('saving');

      const { data: s } = await supabase.auth.getSession();
      const userId = s.session?.user?.id ?? null;
      if (!userId) {
        setSaveStatus('error');
        Alert.alert('저장 실패', '로그인이 필요합니다.');
        setTimeout(() => setSaveStatus('idle'), 1200);
        return;
      }

      // 멤버십에서 tenant_id 1개 조회
      const { data: m, error: mErr } = await supabase
        .from('memberships')
        .select('tenant_id')
        .eq('user_id', userId)
        .limit(1)
        .maybeSingle();

      const tenantId = m?.tenant_id ?? null;
      if (mErr || !tenantId) {
        console.log('[saveScanDirect] no tenant', { mErr, tenantId });
        setSaveStatus('error');
        Alert.alert('저장 실패', '테넌트 정보를 찾지 못했습니다.');
        setTimeout(() => setSaveStatus('idle'), 1200);
        return;
      }

      const row = {
        client_ref: uuid(),
        tenant_id: tenantId,
        user_id: userId,
        type: symbology && symbology.toLowerCase().includes('qr') ? 'qrcode' : 'barcode',
        value,
        created_at: new Date().toISOString(),
        meta: { source: 'mobile', symbology: symbology ?? null },
      };

      const { error } = await supabase.from('scans').insert(row);
      if (error) {
        console.log('[saveScanDirect] insert error:', error, row);
        setSaveStatus('error');
        Alert.alert('저장 실패', error.message ?? '서버 저장에 실패했습니다.');
      } else {
        console.log('[saveScanDirect] insert OK:', row.client_ref);
        setSaveStatus('ok');
      }
    } catch (e: any) {
      console.log('[saveScanDirect] fatal:', e);
      setSaveStatus('error');
      Alert.alert('저장 실패', e?.message ?? '예상치 못한 오류입니다.');
    } finally {
      setTimeout(() => setSaveStatus('idle'), 1200);
    }
  }, []);

  // 카메라 이벤트
  const handleScanned = useCallback(async ({ data, type }: BarcodeScanningResult) => {
    const now = Date.now();
    if (now - lastScannedAt.current < 800) return;           // 디바운스
    if (data && lastDataRef.current === String(data)) return; // 중복 방지

    lastScannedAt.current = now;
    lastDataRef.current = String(data);

    const value = String(data);
    setLastValue(value);

    // 로컬 이력 즉시 반영
    setHistory(prev => [{ id: now, value, type, ts: now }, ...prev].slice(0, 200));

    // 서버 저장
    await saveScanDirect(value, type);

    try { await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); } catch {}
  }, [saveScanDirect]);

  // 렌더
  if (hasPermission === null) {
    return (
      <SafeAreaView style={styles.center} edges={['top','left','right','bottom']}>
        <ActivityIndicator />
        <ThemedText style={{ marginTop: 8 }}>카메라 권한 확인 중…</ThemedText>
      </SafeAreaView>
    );
  }
  if (hasPermission === false) {
    return (
      <SafeAreaView style={styles.center} edges={['top','left','right','bottom']}>
        <ThemedText type="title">카메라 권한 필요</ThemedText>
        <ThemedText style={{ marginTop: 6 }}>설정에서 카메라 권한을 허용해 주세요.</ThemedText>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top','left','right','bottom']}>
      {/* 상태 배너 */}
      <ThemedView style={styles.banner}>
        <ThemedText>
          {saveStatus === 'saving' ? '저장 중…'
            : saveStatus === 'ok' ? '저장 완료 ✓'
            : saveStatus === 'error' ? '저장 실패 ✕'
            : lastValue ? `최근: ${lastValue}` : '스캔 대기'}
        </ThemedText>
      </ThemedView>

      {/* 카메라 */}
      <View style={styles.cameraWrap}>
        {isFocused && (
          <CameraView
            key="main-camera"
            style={StyleSheet.absoluteFillObject}
            facing="back"
            barcodeScannerSettings={{
              barcodeTypes: [
                'qr','code128','code39','ean13','ean8',
                'upc_a','upc_e','itf14','pdf417','datamatrix',
              ],
            }}
            onBarcodeScanned={handleScanned}
          />
        )}
        <View style={styles.frame} pointerEvents="none" />
      </View>

      {/* 스캔 이력 */}
      <ThemedView style={{ paddingHorizontal: 20, paddingTop: 12 }}>
        <ThemedText type="subtitle">스캔 이력</ThemedText>
        {history.length === 0 ? (
          <ThemedText style={{ marginTop: 8 }}>아직 스캔 이력이 없어요.</ThemedText>
        ) : (
          history.slice(0, 30).map(item => (
            <Pressable
              key={item.id}
              onPress={async () => {
                try {
                  const { setStringAsync } = await import('expo-clipboard');
                  await setStringAsync(item.value);
                  try { await Haptics.selectionAsync(); } catch {}
                  Alert.alert('복사됨', '값을 클립보드에 복사했어요.');
                } catch {}
              }}
              onLongPress={() => {
                setHistory(prev => prev.filter(x => x.id !== item.id));
              }}
              style={styles.row}
            >
              <View style={{ flex: 1 }}>
                <ThemedText selectable numberOfLines={1}>{item.value}</ThemedText>
                <ThemedText style={styles.rowMeta}>
                  {fmtLocal24(item.ts)} {item.type ? `• ${item.type}` : ''}
                </ThemedText>
              </View>
            </Pressable>
          ))
        )}
      </ThemedView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  banner: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },

  cameraWrap: {
    aspectRatio: 4 / 3,
    borderRadius: 16,
    overflow: 'hidden',
    position: 'relative',
    backgroundColor: '#000',
    marginTop: 8,
    marginHorizontal: 20,
  },
  frame: {
    position: 'absolute',
    top: height * 0.15,
    left: width * 0.10,
    right: width * 0.10,
    bottom: height * 0.25,
    borderWidth: 2,
    borderRadius: 12,
  },

  row: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth,
    marginTop: 6,
  },
  rowMeta: { opacity: 0.7, fontSize: 12, marginTop: 2 },
});
