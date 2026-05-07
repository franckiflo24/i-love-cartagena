import * as ImagePicker from 'expo-image-picker';
import { Platform } from 'react-native';
import { api } from '../constants/api';

export type ImageUploadResult = {
  uploaded: boolean;
  url?: string;
  verdict: 'AUTO_APPROVE' | 'NEEDS_REVIEW' | 'REJECT';
  caption?: string;
  tags?: string[];
  reason?: string;
  issues?: string[];
};

export async function pickAndUploadImage(
  token: string,
  purpose: 'flyer' | 'profile' = 'flyer',
  aspect: [number, number] = [4, 5],
): Promise<ImageUploadResult | null> {
  const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (status !== 'granted') {
    throw new Error('Permiso de galería denegado');
  }

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    quality: 0.7,
    base64: true,
    allowsEditing: true,
    aspect,
  });

  if (result.canceled || !result.assets?.[0]) return null;
  const asset = result.assets[0];
  let dataUrl = '';
  if (asset.base64) {
    const mime = asset.mimeType || 'image/jpeg';
    dataUrl = `data:${mime};base64,${asset.base64}`;
  } else if (asset.uri && Platform.OS === 'web') {
    // Web fallback: fetch the blob and convert to base64
    const blob = await fetch(asset.uri).then(r => r.blob());
    dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } else {
    throw new Error('No se pudo leer la imagen seleccionada');
  }

  const res = await api.post('/business/upload-image', {
    image_base64: dataUrl,
    purpose,
  }, { headers: { Authorization: `Bearer ${token}` } });
  return res as ImageUploadResult;
}
