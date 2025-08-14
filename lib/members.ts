// lib/members.ts
import { supabase } from '@/lib/supabase';

export type TenantMember = {
  tenant_id: string;
  user_id: string;
  email: string | null;
  role: string | null;
  created_at: string;
};

/** RPC: get_memberships_with_email */
export async function fetchMembersWithEmail(tenantId: string) {
  const { data, error } = await supabase.rpc('get_memberships_with_email', {
    p_tenant: tenantId,
  });
  if (error) throw error;
  return (data ?? []) as TenantMember[];
}
