import { renderHook, act } from '@testing-library/react-native';
import { Linking } from 'react-native';

const mockRequest = jest.fn();
const mockGet = jest.fn();
let mockPermission: { granted: boolean; canAskAgain: boolean } | null = null;

jest.mock('expo-camera', () => ({
  useCameraPermissions: () => [mockPermission, mockRequest, mockGet],
}));

import { useCameraAccess } from '../lib/useCameraAccess';

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
});

describe('useCameraAccess: the "Allow camera" button always does something', () => {
  it('shows the system prompt while the OS will still ask', async () => {
    mockPermission = { granted: false, canAskAgain: true };
    mockRequest.mockResolvedValue({ granted: true, canAskAgain: true });
    const { result } = renderHook(() => useCameraAccess());

    let ok = false;
    await act(async () => { ok = await result.current.ask(); });

    expect(ok).toBe(true);
    expect(mockRequest).toHaveBeenCalled();
    expect(Linking.openSettings).not.toHaveBeenCalled();
  });

  it('opens Settings once the OS has stopped asking, instead of a dead tap', async () => {
    mockPermission = { granted: false, canAskAgain: false };
    const { result } = renderHook(() => useCameraAccess());

    expect(result.current.blocked).toBe(true);
    await act(async () => { await result.current.ask(); });

    expect(mockRequest).not.toHaveBeenCalled();
    expect(Linking.openSettings).toHaveBeenCalledTimes(1);
  });

  it('goes straight to Settings when the prompt is refused for the last time', async () => {
    mockPermission = { granted: false, canAskAgain: true };
    mockRequest.mockResolvedValue({ granted: false, canAskAgain: false });
    const { result } = renderHook(() => useCameraAccess());

    await act(async () => { await result.current.ask(); });

    expect(Linking.openSettings).toHaveBeenCalledTimes(1);
  });

  it('does nothing extra when the camera is already allowed', async () => {
    mockPermission = { granted: true, canAskAgain: true };
    const { result } = renderHook(() => useCameraAccess());

    let ok = false;
    await act(async () => { ok = await result.current.ask(); });

    expect(ok).toBe(true);
    expect(mockRequest).not.toHaveBeenCalled();
    expect(Linking.openSettings).not.toHaveBeenCalled();
  });
});
