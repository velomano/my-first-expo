// features/dev/testSupabase.ts
import { supabase } from '@/lib/supabase';

export async function testSupabaseConnection() {
  // 필요하면 로그인 코드 추가 가능
  // const { error: signInErr } = await supabase.auth.signInWithPassword({ email, password });

  const { data, error } = await supabase
    .from('scans')           // 실제 테이블명
    .select('id, tenant_id, created_at')
    .limit(1);

  if (error) throw new Error(error.message);
  return data ?? [];
}
