// app/(tabs)/_layout.tsx
import { Tabs } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
// app/_layout.tsx 가장 위
import 'react-native-url-polyfill/auto';
import 'react-native-get-random-values';

export default function TabLayout() {
  return (
    <Tabs screenOptions={{ headerShown: false }}>
      <Tabs.Screen name="index" options={{
        title: '홈',
        tabBarIcon: ({ color, focused }) => (
          <Ionicons name={focused ? 'home' : 'home-outline'} size={24} color={color} />
        ),
      }}/>
      <Tabs.Screen name="scan" options={{
        title: '스캔',
        tabBarIcon: ({ color, focused }) => (
          <Ionicons name={focused ? 'qr-code' : 'qr-code-outline'} size={24} color={color} />
        ),
      }}/>
      <Tabs.Screen
  name="history"
  options={{
    title: '이력',
    tabBarIcon: ({ color, focused }) => (
      <Ionicons name={focused ? 'time' : 'time-outline'} size={24} color={color} />
    ),
  }}
/>
      <Tabs.Screen name="settings" options={{
        title: '설정',
        tabBarIcon: ({ color, focused }) => (
          <Ionicons name={focused ? 'settings' : 'settings-outline'} size={24} color={color} />
        ),
      }}/>
    </Tabs>
  );
}
