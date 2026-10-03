import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { colors } from '@/constants/colors';
import { ApiError } from '@/services/api';
import { guessMime, uploadImage, type LocalPhoto } from '@/services/media';

export interface EvidencePhoto extends LocalPhoto {
  id: string;
  /** Upload lifecycle — photos upload eagerly so submit never waits. */
  state: 'uploading' | 'done' | 'error';
  progress: number;
  uploadedUrl?: string;
  errorMessage?: string;
}

interface EvidencePickerProps {
  photos: EvidencePhoto[];
  onChange: (photos: EvidencePhoto[]) => void;
  max: number;
  /** e.g. "At least 2 photos required" — rendered above the picker. */
  hint?: string;
}

let nextId = 0;

export function EvidencePicker({ photos, onChange, max, hint }: EvidencePickerProps) {
  const [pickerError, setPickerError] = useState<string | null>(null);
  const full = photos.length >= max;

  const patch = useCallback(
    (id: string, update: Partial<EvidencePhoto>) => {
      onChange(photos.map((p) => (p.id === id ? { ...p, ...update } : p)));
    },
    [photos, onChange]
  );

  const startUpload = useCallback(
    (photo: EvidencePhoto) => {
      void uploadImage(photo, (fraction) => {
        if (fraction < 1) patch(photo.id, { progress: fraction });
      })
        .then((res) => patch(photo.id, { state: 'done', progress: 1, uploadedUrl: res.url }))
        .catch((err) =>
          patch(photo.id, {
            state: 'error',
            errorMessage: err instanceof ApiError ? err.message : 'Upload failed.',
          })
        );
    },
    [patch]
  );

  const addAssets = useCallback(
    (assets: ImagePicker.ImagePickerAsset[]) => {
      const room = max - photos.length;
      const accepted = assets.slice(0, Math.max(0, room));
      const added: EvidencePhoto[] = accepted.map((a) => {
        const fileName = a.fileName ?? `photo-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.jpg`;
        return {
          id: `p${++nextId}`,
          uri: a.uri,
          fileName,
          mimeType: guessMime(fileName, a.mimeType),
          fileSize: a.fileSize,
          state: 'uploading',
          progress: 0,
        };
      });
      if (!added.length) return;
      onChange([...photos, ...added]);
      added.forEach(startUpload);
      if (assets.length > accepted.length) {
        setPickerError(`Only ${max} photos allowed — extra ${assets.length - accepted.length} skipped.`);
      }
    },
    [max, photos, onChange, startUpload]
  );

  const takePhoto = useCallback(async () => {
    setPickerError(null);
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      setPickerError('Camera access is needed to take evidence photos.');
      return;
    }
    const res = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.8 });
    if (!res.canceled) addAssets(res.assets);
  }, [addAssets]);

  const pickFromLibrary = useCallback(async () => {
    setPickerError(null);
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.8,
      allowsMultipleSelection: true,
      selectionLimit: Math.max(1, max - photos.length),
    });
    if (!res.canceled) addAssets(res.assets);
  }, [addAssets, max, photos.length]);

  const remove = (id: string) => onChange(photos.filter((p) => p.id !== id));

  return (
    <View>
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      {pickerError ? <Text style={styles.errorText}>{pickerError}</Text> : null}
      <View style={styles.grid}>
        {photos.map((p) => (
          <View key={p.id} style={styles.thumbWrap}>
            <Image source={{ uri: p.uri }} style={styles.thumb} />
            {p.state === 'uploading' ? (
              <View style={styles.overlay}>
                <ActivityIndicator color="#FFFFFF" size="small" />
                <Text style={styles.overlayText}>{Math.round(p.progress * 100)}%</Text>
              </View>
            ) : null}
            {p.state === 'error' ? (
              <Pressable
                style={[styles.overlay, styles.overlayError]}
                onPress={() => {
                  patch(p.id, { state: 'uploading', progress: 0, errorMessage: undefined });
                  startUpload(p);
                }}
                accessibilityRole="button"
                accessibilityLabel="Retry upload"
              >
                <Ionicons name="refresh" size={18} color="#FFFFFF" />
                <Text style={styles.overlayText}>Retry</Text>
              </Pressable>
            ) : null}
            {p.state === 'done' ? (
              <View style={styles.doneMark}>
                <Ionicons name="checkmark-circle" size={20} color={colors.accent} />
              </View>
            ) : null}
            <Pressable
              style={styles.removeBtn}
              onPress={() => remove(p.id)}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Remove photo"
            >
              <Ionicons name="close" size={14} color="#FFFFFF" />
            </Pressable>
          </View>
        ))}
        {!full ? (
          <>
            <Pressable style={styles.addTile} onPress={takePhoto} accessibilityRole="button">
              <Ionicons name="camera-outline" size={24} color={colors.accentInk} />
              <Text style={styles.addLabel}>Take photo</Text>
            </Pressable>
            <Pressable style={styles.addTile} onPress={pickFromLibrary} accessibilityRole="button">
              <Ionicons name="images-outline" size={24} color={colors.accentInk} />
              <Text style={styles.addLabel}>Library</Text>
            </Pressable>
          </>
        ) : null}
      </View>
      {photos.length > 0 ? (
        <Text style={styles.count}>
          {photos.filter((p) => p.state === 'done').length} of {photos.length} uploaded
          {max ? ` · max ${max}` : ''}
        </Text>
      ) : null}
    </View>
  );
}

/** All photos finished uploading → their server URLs, else null. */
export const uploadedUrls = (photos: EvidencePhoto[]): string[] | null =>
  photos.every((p) => p.state === 'done' && p.uploadedUrl)
    ? photos.map((p) => p.uploadedUrl!)
    : null;

const styles = StyleSheet.create({
  hint: { fontSize: 13, color: colors.muted, marginBottom: 10, lineHeight: 18 },
  errorText: { fontSize: 13, color: colors.dangerInk, marginBottom: 10 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  thumbWrap: { width: 96, height: 96, borderRadius: 12, overflow: 'hidden' },
  thumb: { width: '100%', height: '100%', backgroundColor: colors.neutralSoft },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(15,23,26,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  overlayError: { backgroundColor: 'rgba(142,51,34,0.72)' },
  overlayText: { color: '#FFFFFF', fontSize: 12, fontWeight: '700' },
  doneMark: { position: 'absolute', right: 4, bottom: 4 },
  removeBtn: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(15,23,26,0.72)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  addTile: {
    width: 96,
    height: 96,
    borderRadius: 12,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.accent,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
  },
  addLabel: { fontSize: 11.5, fontWeight: '600', color: colors.accentInk },
  count: { fontSize: 12.5, color: colors.muted, marginTop: 10 },
});
