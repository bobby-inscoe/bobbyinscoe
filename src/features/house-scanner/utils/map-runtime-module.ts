import { setWorkerUrl } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import 'maplibre-gl/dist/maplibre-gl.css';

// Vite emits the worker separately from the runtime chunk.
setWorkerUrl(workerUrl);

export {
  clearPrewarmedResources,
  Map,
  Marker,
  NavigationControl,
  prewarm,
} from 'maplibre-gl';
