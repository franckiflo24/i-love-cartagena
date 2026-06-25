import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, RADIUS, FONTS } from '../src/constants/theme';
import { useTr } from '../src/i18n/autoTr';

export default function PrivacyScreen() {
  const tr = useTr();
  const router = useRouter();
  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} testID="privacy-back">
          <Ionicons name="arrow-back" size={22} color={COLORS.textMain} />
        </TouchableOpacity>
        <Text style={styles.title}>{tr('Política de Privacidad')}</Text>
      </View>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.versionTag}>{tr('Versión')} 1.0 · {tr('Vigente desde')} mayo 2026</Text>

        <Text style={styles.h1}>{tr('1. Responsable del tratamiento')}</Text>
        <Text style={styles.p}>{tr('Amo Cartagena S.A.S., NIT en trámite, con domicilio en Cartagena de Indias, Colombia, es responsable del tratamiento de tus datos personales conforme a la Ley 1581 de 2012 (Colombia) y el Reglamento General de Protección de Datos (RGPD/GDPR) cuando aplique.')}</Text>
        <Text style={styles.p}>{tr('Contacto del responsable: privacidad@amocartagena.app')}</Text>

        <Text style={styles.h1}>{tr('2. Qué datos recopilamos')}</Text>
        <Text style={styles.p}>{tr('a) Datos de cuenta: nombre, email, foto de perfil (cuando inicias sesión con Google/Apple), número de WhatsApp si lo usas para autenticarte.')}</Text>
        <Text style={styles.p}>{tr('b) Datos de uso: idioma seleccionado, favoritos, búsquedas realizadas, eventos visitados, interacciones con el agente IA.')}</Text>
        <Text style={styles.p}>{tr('c) Datos de dispositivo: token de push notifications, modelo, sistema operativo, ubicación aproximada (solo si concedes permiso, opcional).')}</Text>
        <Text style={styles.p}>{tr('d) Datos de reservas: partner solicitado, fecha, hora, número de personas, notas que escribes para el partner.')}</Text>
        <Text style={styles.p}>{tr('e) Datos de pago: NO almacenamos tu tarjeta. Los pagos son procesados directamente por Wompi (PCI-DSS Level 1). Solo guardamos el identificador de la transacción y el monto.')}</Text>

        <Text style={styles.h1}>{tr('3. Para qué usamos tus datos')}</Text>
        <Text style={styles.p}>{tr('• Autenticarte y mantener tu sesión.')}</Text>
        <Text style={styles.p}>{tr('• Procesar tus reservas y notificarte cuando el partner las confirme.')}</Text>
        <Text style={styles.p}>{tr('• Personalizar recomendaciones del agente IA según tu historial y favoritos.')}</Text>
        <Text style={styles.p}>{tr('• Enviar notificaciones push relevantes (confirmaciones, recordatorios 24h antes de eventos favoritos).')}</Text>
        <Text style={styles.p}>{tr('• Analítica agregada anónima para mejorar el producto y compartir datos estadísticos con la Alcaldía de Cartagena y sponsors (nunca datos individuales identificables).')}</Text>
        <Text style={styles.p}>{tr('• Cumplir obligaciones legales y prevenir fraude.')}</Text>

        <Text style={styles.h1}>{tr('4. Base legal del tratamiento')}</Text>
        <Text style={styles.p}>{tr('Tu consentimiento al aceptar estos términos, la ejecución del contrato (procesar tus reservas y pagos), y nuestro interés legítimo en mejorar el servicio mediante analítica agregada.')}</Text>

        <Text style={styles.h1}>{tr('5. Terceros con los que compartimos datos')}</Text>
        <Text style={styles.p}>{tr('• Wompi (Colombia) — procesamiento de pagos City Pass y Tasa Portuaria.')}</Text>
        <Text style={styles.p}>{tr('• Expo Push Service (USA) — entrega de notificaciones push.')}</Text>
        <Text style={styles.p}>{tr('• Anthropic (Claude) / Google — procesamiento de consultas al agente IA (sin tus datos personales identificables: solo el texto de tu pregunta).')}</Text>
        <Text style={styles.p}>{tr('• Google Sign-In / Apple Sign-In — solo si eliges esos métodos de login.')}</Text>
        <Text style={styles.p}>{tr('• Partners (restaurantes, hoteles) — reciben tu nombre, contacto y detalles de la reserva SOLO si confirman tu solicitud. Los partners FREE reciben datos enmascarados hasta que activan su cuenta PRO.')}</Text>
        <Text style={styles.p}>{tr('NO vendemos tus datos. NO los compartimos con anunciantes externos.')}</Text>

        <Text style={styles.h1}>{tr('6. Tiempo de conservación')}</Text>
        <Text style={styles.p}>{tr('Conservamos tus datos mientras tengas cuenta activa. Si eliminas tu cuenta, borramos tus datos personales en un plazo máximo de 30 días, salvo datos que debamos conservar por obligación legal o fiscal (hasta 5 años para registros de transacciones).')}</Text>

        <Text style={styles.h1}>{tr('7. Tus derechos')}</Text>
        <Text style={styles.p}>{tr('Tienes derecho a: acceder a tus datos, rectificarlos, suprimirlos, oponerte a su tratamiento, solicitar la portabilidad y revocar tu consentimiento. Ejerce estos derechos escribiendo a privacidad@amocartagena.app desde el correo asociado a tu cuenta. Responderemos en máximo 15 días hábiles.')}</Text>
        <Text style={styles.p}>{tr('También puedes presentar quejas ante la Superintendencia de Industria y Comercio de Colombia.')}</Text>

        <Text style={styles.h1}>{tr('8. Seguridad')}</Text>
        <Text style={styles.p}>{tr('Implementamos cifrado HTTPS/TLS en todas las comunicaciones, hashing de contraseñas con bcrypt, tokens JWT firmados, control de acceso por roles (usuario/partner/alcaldía) y respaldos cifrados periódicos.')}</Text>

        <Text style={styles.h1}>{tr('9. Menores de edad')}</Text>
        <Text style={styles.p}>{tr('La app está dirigida a mayores de 13 años. No recopilamos conscientemente datos de menores. Si crees que un menor ha proporcionado datos, escríbenos para borrarlos inmediatamente.')}</Text>

        <Text style={styles.h1}>{tr('10. Cookies y rastreadores')}</Text>
        <Text style={styles.p}>{tr('La app NO usa cookies de seguimiento publicitario. Usamos almacenamiento local (AsyncStorage / SecureStore) solo para guardar tu sesión y preferencias en tu propio dispositivo.')}</Text>

        <Text style={styles.h1}>{tr('11. Transferencias internacionales')}</Text>
        <Text style={styles.p}>{tr('Algunos servicios de terceros (Expo, Anthropic (Claude), Google) procesan datos fuera de Colombia. Estos proveedores cumplen estándares equivalentes de protección y/o cláusulas contractuales tipo aprobadas por la SIC.')}</Text>

        <Text style={styles.h1}>{tr('12. Cambios a esta política')}</Text>
        <Text style={styles.p}>{tr('Si modificamos esta política te notificaremos dentro de la app antes de que entre en vigor.')}</Text>

        <View style={{ height: SPACING.xxl }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: { flexDirection: 'row', alignItems: 'center', gap: SPACING.md, paddingHorizontal: SPACING.lg, paddingVertical: SPACING.sm },
  backBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: COLORS.surface, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 18, color: COLORS.textMain, ...FONTS.bold },
  scroll: { paddingHorizontal: SPACING.lg, paddingBottom: SPACING.xl },
  versionTag: { fontSize: 11, color: COLORS.primary, ...FONTS.bold, letterSpacing: 0.5, marginBottom: SPACING.lg, textTransform: 'uppercase' },
  h1: { fontSize: 15, color: COLORS.textMain, ...FONTS.bold, marginTop: SPACING.lg, marginBottom: 6 },
  p: { fontSize: 13, color: COLORS.textMain, ...FONTS.regular, lineHeight: 20, marginBottom: 8 },
});
