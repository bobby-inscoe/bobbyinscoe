// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useMapPreload } from '@/features/house-scanner/hooks/use-map-preload';

const preload = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const release = vi.hoisted(() => vi.fn());
vi.mock('@/features/house-scanner/utils/map-runtime', () => ({
  preloadWorkspaceMap: preload,
  retainMapWorkspace: () => release,
}));
afterEach(() => {
  vi.useRealTimers();
});

it('defers hidden work, cancels pending fallback work on exit, and does not retry failures on visibility changes', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('requestIdleCallback', undefined);
  // Remove the optional API, matching browsers that need the timer fallback.
  Reflect.deleteProperty(window, 'requestIdleCallback');
  let visible = false;
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() =>
    visible ? 'visible' : 'hidden',
  );
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
    setTimeout(() => callback(0), 16),
  );
  vi.stubGlobal('cancelAnimationFrame', clearTimeout);
  const first = renderHook(useMapPreload);
  await act(() => vi.advanceTimersByTimeAsync(2000));
  expect(preload).not.toHaveBeenCalled();
  visible = true;
  document.dispatchEvent(new Event('visibilitychange'));
  first.unmount();
  await act(() => vi.advanceTimersByTimeAsync(2000));
  expect(preload).not.toHaveBeenCalled();
  expect(release).toHaveBeenCalledOnce();

  preload.mockRejectedValueOnce(new Error('Offline'));
  const second = renderHook(useMapPreload);
  await act(() => vi.advanceTimersByTimeAsync(2000));
  expect(preload).toHaveBeenCalledOnce();
  document.dispatchEvent(new Event('visibilitychange'));
  await act(() => vi.advanceTimersByTimeAsync(2000));
  expect(preload).toHaveBeenCalledOnce();
  second.unmount();
});
