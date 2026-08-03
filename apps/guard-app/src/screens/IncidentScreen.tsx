import React, { useState } from 'react';
import { View, Text, TextInput, ScrollView, StyleSheet, Pressable, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { Audio } from 'expo-av';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';
import { type as typeScale, font } from '../theme/typography';
import { createIncident } from '../api/client';
import { useAuthStore } from '../store/authStore';
import { useT } from '../store/langStore';

// BRD §5.7 (NAZ-056..061): incident type list is exact — do not add/remove entries.
const TYPES: { key: string; labelKey: string }[] = [
  { key: 'speeding', labelKey: 'incSpeeding' },
  { key: 'unauthorized_entry', labelKey: 'incUnauthorizedEntry' },
  { key: 'theft_attempt', labelKey: 'incTheftAttempt' },
  { key: 'medical_emergency', labelKey: 'incMedicalEmergency' },
  { key: 'fight', labelKey: 'incFight' },
  { key: 'property_damage', labelKey: 'incPropertyDamage' },
  { key: 'other', labelKey: 'incOther' },
];

const MIN_DETAILS_LENGTH = 20;

export default function IncidentScreen() {
  const insets = useSafeAreaInsets();
  const t = useT();
  const gateId = useAuthStore((s) => s.user?.gateId) || '';
  const [type, setType] = useState<string | null>(null);
  const [details, setDetails] = useState('');
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [audioUri, setAudioUri] = useState<string | null>(null);
  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [logged, setLogged] = useState(false);

  const canSubmit = !!type && details.trim().length >= MIN_DETAILS_LENGTH && !submitting;

  const takePhoto = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) return;
    const shot = await ImagePicker.launchCameraAsync({ quality: 0.6, allowsEditing: false });
    if (shot.canceled || !shot.assets?.[0]?.uri) return;
    setPhotoUri(shot.assets[0].uri);
  };

  const toggleRecording = async () => {
    if (recording) {
      await recording.stopAndUnloadAsync();
      setAudioUri(recording.getURI() || null);
      setRecording(null);
      return;
    }
    const perm = await Audio.requestPermissionsAsync();
    if (!perm.granted) return;
    await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
    const rec = new Audio.Recording();
    await rec.prepareToRecordAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
    await rec.startAsync();
    setRecording(rec);
  };

  const reset = () => {
    setType(null);
    setDetails('');
    setPhotoUri(null);
    setAudioUri(null);
  };

  const submit = async () => {
    if (!canSubmit || !type) return;
    setSubmitting(true);
    try {
      await createIncident({
        type,
        description: details.trim(),
        gateId,
        photoUri: photoUri || undefined,
        audioUri: audioUri || undefined,
      });
      reset();
      setLogged(true);
      setTimeout(() => setLogged(false), 3000);
    } catch (err: any) {
      Alert.alert(t('error'), err?.response?.data?.error?.message || t('failIncident'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Text style={typeScale.h2}>{t('navIncident')}</Text>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {logged && (
          <View style={styles.loggedBanner}>
            <MaterialCommunityIcons name="check-circle" size={18} color={colors.teal} />
            <Text style={styles.loggedText}>{t('incidentLogged')}</Text>
          </View>
        )}

        <View style={styles.chipGrid}>
          {TYPES.map((opt) => (
            <Pressable
              key={opt.key}
              style={[styles.chip, type === opt.key && styles.chipActive]}
              onPress={() => setType(opt.key)}
            >
              <Text style={[styles.chipText, type === opt.key && styles.chipTextActive]}>{t(opt.labelKey as any)}</Text>
            </Pressable>
          ))}
        </View>

        <TextInput
          testID="incident-details-input"
          style={styles.input}
          placeholder={t('description')}
          placeholderTextColor={colors.textTertiary}
          value={details}
          onChangeText={setDetails}
          multiline
          numberOfLines={4}
        />
        {details.length > 0 && details.trim().length < MIN_DETAILS_LENGTH && (
          <Text style={styles.hint}>{t('detailsMinLength')}</Text>
        )}

        <View style={styles.attachRow}>
          <Pressable testID="incident-photo-button" style={styles.attachBtn} onPress={takePhoto}>
            <MaterialCommunityIcons name="camera" size={16} color={colors.actionPrimary} />
            <Text style={styles.attachBtnText}>{photoUri ? t('retakePhoto') : t('takePhoto')}</Text>
          </Pressable>
          <Pressable testID="record-voice-button" style={styles.attachBtn} onPress={toggleRecording}>
            <MaterialCommunityIcons name={recording ? 'stop-circle' : 'microphone'} size={16} color={recording ? colors.danger : colors.actionPrimary} />
            <Text style={[styles.attachBtnText, recording && { color: colors.danger }]}>
              {recording ? t('stopRecording') : t('recordVoiceNote')}
            </Text>
          </Pressable>
        </View>

        {audioUri && <Text style={styles.hint}>{t('transcriptionPending')}</Text>}

        <Pressable
          testID="submit-incident-button"
          style={[styles.submitBtn, !canSubmit && styles.submitBtnDisabled]}
          onPress={submit}
          disabled={!canSubmit}
        >
          <Text style={styles.submitBtnText}>{t('submitIncident')}</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgPrimary },
  header: { backgroundColor: colors.surface, paddingHorizontal: spacing.lg, paddingBottom: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  content: { padding: spacing.lg, gap: spacing.sm },
  loggedBanner: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: 'rgba(0,191,166,0.15)', borderRadius: radius.md, padding: spacing.md },
  loggedText: { ...font(700), fontSize: 13, color: colors.teal },
  chipGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  chip: { paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.elevated },
  chipActive: { borderColor: colors.actionPrimary, backgroundColor: 'rgba(245,158,11,0.15)' },
  chipText: { ...font(400), fontSize: 12, color: colors.textSecondary },
  chipTextActive: { color: colors.actionPrimary, ...font(700) },
  input: { backgroundColor: colors.elevated, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, padding: spacing.md, fontSize: 15, color: colors.textPrimary, minHeight: 90, textAlignVertical: 'top' },
  hint: { ...font(400), fontSize: 11, color: colors.danger },
  attachRow: { flexDirection: 'row', gap: spacing.md },
  attachBtn: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, padding: spacing.xs },
  attachBtnText: { ...font(500), fontSize: 12, color: colors.actionPrimary },
  submitBtn: { alignItems: 'center', padding: spacing.md, backgroundColor: colors.teal, borderRadius: radius.md },
  submitBtnDisabled: { opacity: 0.4 },
  submitBtnText: { ...font(700), fontSize: 14, color: colors.white },
});
