export const STREET_STYLE = 'https://tiles.openfreemap.org/styles/liberty';

type Runtime = typeof import('./map-runtime-module');
let pending: Promise<Runtime> | undefined;
let runtime: Runtime | undefined;
let workspaces = 0;
let maps = 0;
let warmed = false;

function releaseWorkers() {
  if (!workspaces && !maps && warmed) {
    // MapLibre 6.14 retains its shared worker pool through the global dispatcher after map use.
    runtime?.clearPrewarmedResources();
    warmed = false;
  }
}

export function loadMapRuntime() {
  pending ??= import('./map-runtime-module').then(
    (module) => {
      runtime = module;
      return module;
    },
    (error) => {
      pending = undefined;
      throw error;
    },
  );
  return pending;
}

export function retainMap() {
  maps++;
  return () => {
    maps--;
    releaseWorkers();
  };
}

// The caller owns cancellation; a late import may be cached but must not warm an abandoned workspace.
export function preloadWorkspaceMap() {
  return loadMapRuntime().then((module) => {
    if (workspaces && !warmed) {
      module.prewarm();
      warmed = true;
    }
  });
}

export function retainMapWorkspace() {
  workspaces++;
  return () => {
    workspaces--;
    releaseWorkers();
  };
}
