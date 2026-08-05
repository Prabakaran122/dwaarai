import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';

// The server caps an issue at five photos and 10MB each
// (MAX_ISSUE_PHOTOS in services/api-gateway/src/routes/issues.js). Compressing
// to 1200px keeps a phone photo well under that and keeps uploads usable on a
// weak connection.
export const MAX_ISSUE_PHOTOS = 5;
export const TARGET_WIDTH = 1200;

export async function compressForUpload(uri: string): Promise<string> {
  try {
    const result = await ImageManipulator.manipulateAsync(
      uri,
      [{ resize: { width: TARGET_WIDTH } }],
      { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG }
    );
    return result.uri;
  } catch {
    // Uploading the original is better than silently dropping the evidence the
    // resident took the trouble to attach.
    return uri;
  }
}

export async function pickIssuePhotos(existingCount: number): Promise<string[]> {
  const remaining = MAX_ISSUE_PHOTOS - existingCount;
  if (remaining <= 0) return [];

  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) return [];

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    allowsMultipleSelection: true,
    selectionLimit: remaining,
    quality: 1,
  });
  if (result.canceled) return [];

  return Promise.all(result.assets.map((asset) => compressForUpload(asset.uri)));
}
