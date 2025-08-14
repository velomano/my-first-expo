// lib/supabase.ts
import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';

// SecureStore adapter
type StorageAdapter = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem: (key: string) => Promise<void>;
};
const ExpoSecureStorage: StorageAdapter = {
  getItem: (k) => SecureStore.getItemAsync(k),
  setItem: (k, v) => SecureStore.setItemAsync(k, v),
  removeItem: (k) => SecureStore.deleteItemAsync(k),
};

// ⬇️ 너 프로젝트의 “Project URL”과 “anon public API key”를 정확히 넣기
const SUPABASE_URL = 'https://lklkkpdsubwaopzmkzum.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxrbGtrcGRzdWJ3YW9wem1renVtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTUwNTc0OTAsImV4cCI6MjA3MDYzMzQ5MH0.HZSJmjnME9K4-3n7bbM5EvXgS-F5rp08pQ_GGRbafeE'; // 캡처에 보인 긴 문자열 전체

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error('Supabase URL/KEY 누락');
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: ExpoSecureStorage as any,
    storageKey: 'sb_myfirstexpo_auth', // 영숫자/._- 만 사용
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

// 네트워크 점검용 핑
export async function pingSupabase() {
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/health`);
    console.log('[PING]', r.status, r.ok);
  } catch (e) {
    console.log('[PING] failed', e);
  }
}
