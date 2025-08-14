// lib/tenantStorage.ts
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'tenantId';

export async function setTenantId(id: string) {
  await AsyncStorage.setItem(KEY, id);
}

export async function getTenantId() {
  return AsyncStorage.getItem(KEY);
}
