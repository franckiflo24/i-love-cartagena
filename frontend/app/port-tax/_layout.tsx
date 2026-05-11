import { Stack } from 'expo-router';

export default function PortTaxLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        animation: 'slide_from_right',
        contentStyle: { backgroundColor: '#050814' },
      }}
    />
  );
}
