import { beforeEach, expect, it, vi } from 'vitest';

const runtime = vi.hoisted(() => ({
  prewarm: vi.fn(),
  clearPrewarmedResources: vi.fn(),
}));
vi.mock('./map-runtime-module', () => runtime);
beforeEach(() => {
  vi.resetModules();
});

it('joins concurrent loads and keeps warmed workers until the last map and workspace leave', async () => {
  const { loadMapRuntime, retainMapWorkspace, retainMap, preloadWorkspaceMap } =
    await import('./map-runtime');
  const leave = retainMapWorkspace();
  const leaveOther = retainMapWorkspace();
  expect(loadMapRuntime()).toBe(loadMapRuntime());
  await Promise.all([preloadWorkspaceMap(), preloadWorkspaceMap()]);
  expect(runtime.prewarm).toHaveBeenCalledOnce();
  const removeMap = retainMap();
  leave();
  leaveOther();
  expect(runtime.clearPrewarmedResources).not.toHaveBeenCalled();
  removeMap();
  expect(runtime.clearPrewarmedResources).toHaveBeenCalledOnce();
});

it('does not warm a workspace that left during a pending import', async () => {
  const { retainMapWorkspace, preloadWorkspaceMap } = await import(
    './map-runtime'
  );
  const leave = retainMapWorkspace();
  const pending = preloadWorkspaceMap();
  leave();
  await pending;
  expect(runtime.prewarm).not.toHaveBeenCalled();
  expect(runtime.clearPrewarmedResources).not.toHaveBeenCalled();
});
