import React from 'react';
import { View, Text, Pressable, Linking } from 'react-native';
import { Stack } from 'expo-router';

/**
 * /eventos  (native: iOS / Android)
 * Loads the same ticket-wallet experience from the deployed web asset.
 * Web uses eventos.web.tsx instead — this file never runs on web, so the
 * react-native-webview require below cannot affect the web build.
 *
 * Set HOST to your production host.
 */
const HOST = process.env.EXPO_PUBLIC_APP_URL || 'https://amocartagena.co';
const URL = `${HOST}/eventos-app.html`;

let WebView: any = null;
try {
  // Optional dependency. If absent, we fall back to a deep link.
  WebView = require('react-native-webview').WebView;
} catch (e) {
  WebView = null;
}

export default function EventosScreen() {
  return (
    <>
      <Stack.Screen options={{ title: 'Mi entrada' }} />
      {WebView ? (
        <WebView source={{ uri: URL }} style={{ flex: 1, backgroundColor: '#0c0910' }} />
      ) : (
        <View
          style={{
            flex: 1,
            backgroundColor: '#0c0910',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 24,
          }}
        >
          <Text style={{ color: '#f6efea', fontSize: 16, fontWeight: '600', marginBottom: 8 }}>
            Mi entrada
          </Text>
          <Text style={{ color: '#a38fb0', fontSize: 13, textAlign: 'center', marginBottom: 18 }}>
            Instala react-native-webview para ver la entrada aquí, o ábrela en la versión web.
          </Text>
          <Pressable
            onPress={() => Linking.openURL(URL)}
            style={{ backgroundColor: '#f3b14e', borderRadius: 12, paddingVertical: 13, paddingHorizontal: 22 }}
          >
            <Text style={{ color: '#2a1c06', fontWeight: '700' }}>Abrir entrada</Text>
          </Pressable>
        </View>
      )}
    </>
  );
}
