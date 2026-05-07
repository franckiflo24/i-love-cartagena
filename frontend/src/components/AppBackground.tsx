import React from 'react';
import { ImageBackground, Platform, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { IMAGES } from '../constants/theme';

interface Props {
  children: React.ReactNode;
}

/**
 * Global app background: warm Cartagena Cathedral sunset photo
 * with a heavy dark gradient overlay so light text remains readable.
 *
 * On web we ALSO inject a fixed-position background on document.body
 * so it stays visible behind expo-router's navigation containers.
 */
export default function AppBackground({ children }: Props) {
  React.useEffect(() => {
    if (Platform.OS !== 'web') return;
    const styleId = '__amo_cartagena_bg__';
    if (typeof document === 'undefined') return;
    if (document.getElementById(styleId)) return;
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
      html {
        background: #050814 !important;
      }
      body, #root, #__next {
        background: transparent !important;
      }
      body::before {
        content: '';
        position: fixed;
        inset: 0;
        background-image: url('${IMAGES.cathedralSunset}');
        background-size: cover;
        background-position: center center;
        z-index: -2;
        pointer-events: none;
      }
      body::after {
        content: '';
        position: fixed;
        inset: 0;
        background:
          linear-gradient(180deg, rgba(217,119,6,0.20) 0%, rgba(217,119,6,0) 30%),
          linear-gradient(180deg, rgba(5,8,20,0.55) 0%, rgba(5,8,20,0.70) 50%, rgba(5,8,20,0.85) 100%);
        z-index: -1;
        pointer-events: none;
      }
      /* Ensure root navigation containers don't draw their own opaque bg */
      body > div {
        background-color: transparent !important;
        position: relative;
        z-index: 1;
      }
      body > div > div,
      body > div > div > div,
      body > div > div > div > div,
      body > div > div > div > div > div,
      body > div > div > div > div > div > div {
        background-color: transparent !important;
      }
    `;
    document.head.appendChild(style);
  }, []);

  if (Platform.OS === 'web') {
    return <View style={styles.contentWeb}>{children}</View>;
  }

  return (
    <View style={styles.root}>
      <ImageBackground
        source={{ uri: IMAGES.cathedralSunset }}
        style={styles.bg}
        resizeMode="cover"
      >
        <LinearGradient
          colors={[
            'rgba(5, 8, 20, 0.35)',
            'rgba(5, 8, 20, 0.55)',
            'rgba(5, 8, 20, 0.75)',
          ]}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
        <LinearGradient
          colors={[
            'rgba(217, 119, 6, 0.20)',
            'rgba(217, 119, 6, 0.0)',
          ]}
          locations={[0, 0.45]}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
        <View style={styles.content}>{children}</View>
      </ImageBackground>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#050814' },
  bg: { flex: 1, width: '100%', height: '100%' },
  content: { flex: 1, backgroundColor: 'transparent' },
  contentWeb: { flex: 1, backgroundColor: 'transparent' },
});
