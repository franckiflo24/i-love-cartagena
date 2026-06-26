import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, RADIUS, FONTS } from '../src/constants/theme';
import { useTr } from '../src/i18n/autoTr';

export default function TermsScreen() {
  const tr = useTr();
  const router = useRouter();
  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} testID="terms-back">
          <Ionicons name="arrow-back" size={22} color={COLORS.textMain} />
        </TouchableOpacity>
        <Text style={styles.title}>{tr('Términos y Condiciones')}</Text>
      </View>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.versionTag}>{tr('Versión')} 2.0 · {tr('Vigente desde')} junio 2026</Text>

        <Text style={styles.h1}>{tr('1. Bienvenido a Amo Cartagena')}</Text>
        <Text style={styles.p}>{tr('Amo Cartagena es una aplicación móvil que conecta visitantes con la oferta cultural, gastronómica y de hospitalidad de Cartagena de Indias, Colombia. Al usar la app aceptas estos Términos. Si no estás de acuerdo, no uses el servicio.')}</Text>

        <Text style={styles.h1}>{tr('2. Quiénes somos')}</Text>
        <Text style={styles.p}>{tr('La plataforma es propiedad de Amo Cartagena S.A.S. (NIT en trámite), con domicilio en Cartagena de Indias, Colombia. La tecnología es operada por MachineMind LLC (Wyoming, EE.UU.) como proveedor tecnológico. Tu contrato por el Servicio es con Amo Cartagena S.A.S. Contacto: soporte@amocartagena.app')}</Text>

        <Text style={styles.h1}>{tr('3. Cuenta de usuario')}</Text>
        <Text style={styles.p}>{tr('Puedes registrarte con Google, Apple, WhatsApp o correo electrónico. Eres responsable de la veracidad de tus datos y de la seguridad de tu cuenta. Debes tener al menos 13 años de edad.')}</Text>
        <Text style={styles.p}>{tr('Notifícanos inmediatamente si sospechas uso no autorizado de tu cuenta. Podemos suspender o terminar cuentas que violen estos Términos o la ley aplicable. Puedes eliminar tu cuenta en cualquier momento desde Perfil → Eliminar mi cuenta.')}</Text>

        <Text style={styles.h1}>{tr('4. Reservas con partners')}</Text>
        <Text style={styles.p}>{tr('Amo Cartagena actúa como intermediario entre tú y los partners (restaurantes, hoteles, clubs, beach clubs, etc.). Las reservas son solicitudes que el partner confirma o rechaza manualmente. La aplicación NO procesa pagos directos por reservas — esos pagos se realizan directamente con el partner mediante el link de pago que ellos proporcionan o en su sitio físico.')}</Text>
        <Text style={styles.p}>{tr('La calidad del servicio, productos y experiencia final son responsabilidad exclusiva del partner. Amo Cartagena no garantiza disponibilidad, precios ni horarios mostrados, los cuales pueden cambiar sin previo aviso.')}</Text>
        <Text style={styles.p}>{tr('Las cancelaciones realizadas con menos de 24 horas de antelación pueden estar sujetas a cargos según la política del partner.')}</Text>

        <Text style={styles.h1}>{tr('5. City Pass y Tasa Portuaria')}</Text>
        <Text style={styles.p}>{tr('Las compras de City Pass (acceso a experiencias curadas) y Tasa Portuaria (impuesto oficial para visitar Islas) se procesan a través de Wompi, pasarela de pago licenciada por la Superintendencia Financiera de Colombia. Los montos pagados se rigen por la regulación local. Las devoluciones se gestionan caso a caso enviando un correo a soporte@amocartagena.app.')}</Text>

        <Text style={styles.h1}>{tr('6. Conducta del usuario')}</Text>
        <Text style={styles.p}>{tr('Te comprometes a NO: (a) usar la app con fines ilícitos; (b) suplantar a otra persona; (c) interferir con la seguridad o desempeño de la plataforma; (d) publicar contenido ofensivo, discriminatorio o falso; (e) revender el servicio sin autorización.')}</Text>

        <Text style={styles.h1}>{tr('7. Inteligencia Artificial')}</Text>
        <Text style={styles.p}>{tr('La app incluye un agente conversacional ("Amo IA") y recomendaciones generadas con modelos de lenguaje. Las sugerencias son orientativas y pueden contener errores. Verifica siempre la información crítica (horarios, precios, disponibilidad) directamente con el partner antes de tomar decisiones.')}</Text>

        <Text style={styles.h1}>{tr('8. Propiedad intelectual')}</Text>
        <Text style={styles.p}>{tr('Todo el contenido propio de la app (código, diseño, marca "Amo Cartagena", textos, ilustraciones) es propiedad de Amo Cartagena S.A.S. La tecnología subyacente de la plataforma es propiedad de MachineMind LLC y se licencia al Proveedor. Las fotografías y marcas de partners pertenecen a sus respectivos titulares y se muestran bajo licencia o autorización. Se te otorga una licencia limitada, no exclusiva y revocable para usar la app con fines personales y no comerciales.')}</Text>

        <Text style={styles.h1}>{tr('8b. Servicios de terceros')}</Text>
        <Text style={styles.p}>{tr('La app integra y enlaza servicios de terceros (mapas, pagos, mensajería, reservas). Tu uso de esos servicios se rige por sus propios términos y políticas de privacidad. No somos responsables por servicios de terceros.')}</Text>

        <Text style={styles.h1}>{tr('8c. Programa de Recompensas')}</Text>
        <Text style={styles.p}>{tr('Los puntos del programa AMO Rewards no tienen valor en efectivo, no son transferibles salvo que se indique lo contrario, y pueden expirar o cambiar según las reglas del programa. Los beneficios, niveles y condiciones se describen en la sección de Rewards de la app.')}</Text>

        <Text style={styles.h1}>{tr('9. Limitación de responsabilidad')}</Text>
        <Text style={styles.p}>{tr('En el máximo permitido por la ley colombiana, Amo Cartagena S.A.S. no será responsable por: pérdida de datos, lucro cesante, daño indirecto, o cualquier incidente derivado de la interacción con un partner o del uso de la app. La responsabilidad total no excederá los montos efectivamente pagados por ti a la plataforma en los últimos 12 meses.')}</Text>

        <Text style={styles.h1}>{tr('10. Modificaciones')}</Text>
        <Text style={styles.p}>{tr('Podemos actualizar estos Términos en cualquier momento. La fecha de última actualización aparece arriba. El uso continuado de la app después de un cambio implica la aceptación de los nuevos Términos.')}</Text>

        <Text style={styles.h1}>{tr('11. Ley aplicable y jurisdicción')}</Text>
        <Text style={styles.p}>{tr('Estos Términos se rigen por las leyes de la República de Colombia. Cualquier disputa será resuelta ante los jueces de Cartagena de Indias, renunciando expresamente a cualquier otro fuero.')}</Text>

        <Text style={styles.h1}>{tr('12. Indemnización')}</Text>
        <Text style={styles.p}>{tr('Aceptas indemnizar y mantener indemne a Amo Cartagena S.A.S. y MachineMind LLC de reclamaciones, daños y gastos derivados de tu uso indebido de la app o tu violación de estos Términos o la ley aplicable, en la medida permitida por la ley.')}</Text>

        <Text style={styles.h1}>{tr('13. Contacto')}</Text>
        <Text style={styles.p}>{tr('Proveedor: Amo Cartagena S.A.S., Cartagena de Indias, Colombia. soporte@amocartagena.app')}</Text>
        <Text style={styles.p}>{tr('Operador tecnológico: MachineMind LLC, 30 N Gould St Ste R, Sheridan, WY 82801, USA.')}</Text>

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
