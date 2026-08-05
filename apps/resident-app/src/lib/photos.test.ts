import { pickIssuePhotos, compressForUpload, MAX_ISSUE_PHOTOS, TARGET_WIDTH } from './photos';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';

jest.mock('expo-image-picker');
jest.mock('expo-image-manipulator');

beforeEach(() => {
  jest.clearAllMocks();
  (ImagePicker.requestMediaLibraryPermissionsAsync as jest.Mock).mockResolvedValue({ granted: true });
  (ImagePicker.launchImageLibraryAsync as jest.Mock).mockResolvedValue({
    canceled: false,
    assets: [{ uri: 'file:///raw1.jpg' }, { uri: 'file:///raw2.jpg' }],
  });
  (ImageManipulator.manipulateAsync as jest.Mock).mockImplementation((uri: string) =>
    Promise.resolve({ uri: `${uri}.small` })
  );
});

describe('compressForUpload', () => {
  it('resizes to the 1200px target before upload', async () => {
    const out = await compressForUpload('file:///raw1.jpg');
    expect(ImageManipulator.manipulateAsync).toHaveBeenCalledWith(
      'file:///raw1.jpg',
      // The literal, not TARGET_WIDTH — asserting against the constant the
      // module exports would track any change to it and prove nothing. The
      // BRD specifies 1200px.
      [{ resize: { width: 1200 } }],
      expect.objectContaining({ compress: expect.any(Number) })
    );
    expect(out).toBe('file:///raw1.jpg.small');
  });

  it('falls back to the original when compression fails, rather than losing the photo', async () => {
    (ImageManipulator.manipulateAsync as jest.Mock).mockRejectedValue(new Error('nope'));
    await expect(compressForUpload('file:///raw1.jpg')).resolves.toBe('file:///raw1.jpg');
  });
});

describe('pickIssuePhotos', () => {
  it('compresses everything it picks', async () => {
    const uris = await pickIssuePhotos(0);
    expect(uris).toEqual(['file:///raw1.jpg.small', 'file:///raw2.jpg.small']);
  });

  it('never picks past the five-photo cap', async () => {
    await pickIssuePhotos(3);
    const opts = (ImagePicker.launchImageLibraryAsync as jest.Mock).mock.calls[0][0];
    expect(opts.selectionLimit).toBe(2);
  });

  it('returns nothing when the cap is already reached, without opening the picker', async () => {
    const uris = await pickIssuePhotos(MAX_ISSUE_PHOTOS);
    expect(uris).toEqual([]);
    expect(ImagePicker.launchImageLibraryAsync).not.toHaveBeenCalled();
  });

  it('returns nothing when permission is refused', async () => {
    (ImagePicker.requestMediaLibraryPermissionsAsync as jest.Mock).mockResolvedValue({ granted: false });
    const uris = await pickIssuePhotos(0);
    expect(uris).toEqual([]);
    expect(ImagePicker.launchImageLibraryAsync).not.toHaveBeenCalled();
  });

  it('returns nothing when the user cancels', async () => {
    (ImagePicker.launchImageLibraryAsync as jest.Mock).mockResolvedValue({ canceled: true, assets: [] });
    const uris = await pickIssuePhotos(0);
    expect(uris).toEqual([]);
  });
});
