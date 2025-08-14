// lib/resolveTenant.ts
import { supabase } from '@/lib/supabase';
import { getTenantId, setTenantId } from '@/lib/tenantStorage';

/**
 * 저장된 tenantId가 없으면 memberships에서 자동 선택해 저장 후 반환
 * 우선순위: owner > admin > member
 */
export async function ensureTenantId(): Promise<string> {
  // 1) 이미 저장돼 있으면 그대로 반환
  const existing = await getTenantId();
  if (existing) return existing;

  // 2) 로그인 유저 확인
  const { data: userRes, error: userErr } = await supabase.auth.getUser();
  if (userErr) throw userErr;
  const userId = userRes.user?.id;
  if (!userId) throw new Error('로그인이 필요합니다.');

  // 3) 내 멤버십 조회
  const { data: mems, error } = await supabase
    .from('memberships')
    .select('tenant_id, role')        // 이름이 필요하면 조인 추가 가능
    .eq('user_id', userId);

  if (error) throw error;
  if (!mems || mems.length === 0) {
    throw new Error('가입된 테넌트가 없습니다.');
  }

  // 4) 역할 우선순위로 정렬 후 선택
  const priority: Record<string, number> = { owner: 3, admin: 2, member: 1 };
  mems.sort((a, b) => (priority[b.role] ?? 0) - (priority[a.role] ?? 0));

  const id = mems[0].tenant_id as string;

  // 5) 저장 후 반환
  await setTenantId(id);
  return id;
}
