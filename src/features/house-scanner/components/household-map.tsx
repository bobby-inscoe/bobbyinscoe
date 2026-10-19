import { Button, Group, Popover, Stack, Text } from '@mantine/core';
import {
  Map as MapLibreMap,
  Marker,
  NavigationControl,
  type StyleSpecification,
  setWorkerUrl,
} from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import 'maplibre-gl/dist/maplibre-gl.css';

import styles from '@/features/house-scanner/components/household-map.module.css';
import { MapPinGuide } from '@/features/house-scanner/components/map-pin-guide';
import type { MapPoint } from '@/features/house-scanner/utils/listing-view';
import {
  clusterExpansionZoom,
  clusterMapPoints,
  type MapGroup,
} from '@/features/house-scanner/utils/map-clusters';
import { mapSelectionIds } from '@/features/house-scanner/utils/map-selection';

// MapLibre resolves its default worker beside import.meta.url, which Vite rewrites.
setWorkerUrl(workerUrl);

const MAX_STACK_BUTTONS = 6;
// Room kept around a pin so its marker is not clipped, and between the card and the map edge.
const MARKER_MARGIN = 24;
const CARD_GAP = 24;
// Minimum marker size on coarse pointers.
const MARKER_SIZE = 44;

function esriReference(service: string) {
  return {
    type: 'raster' as const,
    tiles: [
      `https://server.arcgisonline.com/ArcGIS/rest/services/Reference/${service}/MapServer/tile/{z}/{y}/{x}`,
    ],
    tileSize: 256,
    maxzoom: 19,
    attribution: 'Labels © Esri',
  };
}

const SATELLITE_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    imagery: {
      type: 'raster',
      tiles: [
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      ],
      tileSize: 256,
      maxzoom: 19,
      attribution: 'Imagery © Esri, Maxar, Earthstar Geographics',
    },
    // Esri's transparent reference tiles draw street and place names over the imagery.
    roads: esriReference('World_Transportation'),
    places: esriReference('World_Boundaries_and_Places'),
  },
  layers: [
    { id: 'imagery', type: 'raster', source: 'imagery' },
    { id: 'roads', type: 'raster', source: 'roads' },
    { id: 'places', type: 'raster', source: 'places' },
  ],
};

// Rows kept clear at the top so the corner controls never hide a marker.
function controlsInset(element: HTMLElement | null) {
  return element ? element.offsetTop + element.offsetHeight + MARKER_MARGIN : 0;
}

interface MarkerEntry {
  group: MapGroup;
  marker: Marker;
  button: HTMLButtonElement;
  // The homes sharing this marker.
  ids: string[];
}

export interface MapCameraState {
  center: [number, number];
  zoom: number;
  bearing: number;
  pitch: number;
}

const NO_CHECKED_IDS: ReadonlySet<string> = new Set();

// Preview and batch selection are independent: opening another home must not clear the batch.
function markPressed(
  entries: MarkerEntry[],
  selectedId: string | null,
  selectionMode: boolean,
  checkedIds: ReadonlySet<string>,
  disabled: boolean,
) {
  for (const { button, ids, group } of entries) {
    const checked = ids.filter((id) => checkedIds.has(id)).length;
    const previewed = selectedId !== null && ids.includes(selectedId);
    // Avoid changing attributes on every other pin when only one checkbox changes.
    const set = (name: string, value: string) => {
      if (button.getAttribute(name) !== value) button.setAttribute(name, value);
    };
    set('data-preview', String(previewed));
    set('data-selection-mode', String(selectionMode));
    set('data-batch-checked', String(selectionMode && checked > 0));
    set('data-batch-partial', String(checked > 0 && checked < ids.length));
    set('aria-pressed', String(selectionMode ? checked > 0 : previewed));
    const isDisabled =
      selectionMode &&
      ids.length === 1 &&
      (disabled ||
        (checkedIds.size >= 500 && checked === 0) ||
        group.points[0].dimmed === true);
    if (button.disabled !== isDisabled) button.disabled = isDisabled;
    const label = button.dataset.label ?? '';
    set(
      'aria-label',
      selectionMode
        ? `${label}. ${checked} selected${ids.length === 1 ? '. Tap to toggle selection and preview' : '. Open to choose individual homes'}`
        : label,
    );
  }
}

interface HouseholdMapProps {
  points: MapPoint[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  // Navigating within a shared building previews a home without selecting unseen neighbors.
  onPreview?: (id: string) => void;
  onOpenStack?: (ids: string[]) => void;
  selectionMode?: boolean;
  checkedIds?: ReadonlySet<string>;
  selectionDisabled?: boolean;
  // Bare-map clicks and Escape close the preview while keeping the batch selection.
  onDeselect: () => void;
  styleUrl?: string;
  satellite?: boolean;
  fillMobile?: boolean;
  // Drawn over the map, for the selected home's card.
  overlay?: ReactNode;
  // Small controls in the map's top-left corner, clear of MapLibre's own top-right ones.
  controls?: ReactNode;
  // Captures located points in the unobscured map area at the moment of the click.
  onCaptureView?: (ids: string[]) => void;
  captureDisabled?: boolean;
  // The parent can keep this ref while the map unmounts for another view.
  camera?: { current: MapCameraState | null };
}

export function HouseholdMap({
  points,
  selectedId,
  onSelect,
  onDeselect,
  onPreview = onSelect,
  onOpenStack,
  selectionMode = false,
  checkedIds = NO_CHECKED_IDS,
  selectionDisabled = false,
  styleUrl = 'https://tiles.openfreemap.org/styles/liberty',
  satellite = false,
  fillMobile = false,
  overlay,
  controls,
  onCaptureView,
  captureDisabled = false,
  camera,
}: HouseholdMapProps) {
  const container = useRef<HTMLElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [stack, setStack] = useState<string[]>([]);
  const [unlocatedOpen, setUnlocatedOpen] = useState(false);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const previewRef = useRef(onPreview);
  previewRef.current = onPreview;
  const openStackRef = useRef(onOpenStack);
  openStackRef.current = onOpenStack;
  const selectionRef = useRef({ selectionMode, checkedIds, selectionDisabled });
  selectionRef.current = { selectionMode, checkedIds, selectionDisabled };
  const onDeselectRef = useRef(onDeselect);
  onDeselectRef.current = onDeselect;
  const stageRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const controlsRef = useRef<HTMLDivElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);
  const markers = useRef<MarkerEntry[]>([]);
  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;
  const satelliteRef = useRef(satellite);
  satelliteRef.current = satellite;
  const appliedSatellite = useRef(satellite);
  const located = points.filter((point) => !point.unlocated);
  const unlocated = points.filter((point) => point.unlocated);
  const first = useRef(located[0]?.coordinates).current;
  // Only homes with real positions determine the first view.
  const bounds = useRef(
    located.length > 1
      ? ([
          [
            Math.min(...located.map((p) => p.coordinates.longitude)),
            Math.min(...located.map((p) => p.coordinates.latitude)),
          ],
          [
            Math.max(...located.map((p) => p.coordinates.longitude)),
            Math.max(...located.map((p) => p.coordinates.latitude)),
          ],
        ] as [[number, number], [number, number]])
      : undefined,
  ).current;
  const centerLongitude = first?.longitude ?? 11.9746;
  const centerLatitude = first?.latitude ?? 57.7089;
  useEffect(() => {
    if (!container.current || error) return;
    let instance: MapLibreMap | null = null;
    try {
      const savedCamera = camera?.current;
      instance = new MapLibreMap({
        container: container.current,
        style: satelliteRef.current ? SATELLITE_STYLE : styleUrl,
        center: savedCamera?.center ?? [centerLongitude, centerLatitude],
        zoom: savedCamera?.zoom ?? 11,
        bearing: savedCamera?.bearing ?? 0,
        pitch: savedCamera?.pitch ?? 0,
        ...(savedCamera ? {} : { bounds }),
        fitBoundsOptions: {
          padding: {
            top: Math.max(56, controlsInset(controlsRef.current)),
            right: 96,
            bottom: 56,
            left: 96,
          },
          maxZoom: 14,
        },
        attributionControl: { compact: false },
        cooperativeGestures: false,
      });
      map.current = instance;
      appliedSatellite.current = satelliteRef.current;
      instance.addControl(new NavigationControl());
      instance.on('load', () => setLoaded(true));
      // MapLibre also reports a click on a marker, and none after a drag.
      instance.on('click', ({ originalEvent }) => {
        const { target } = originalEvent;
        if (target instanceof Element && target.closest(`.${styles.marker}`))
          return;
        onDeselectRef.current();
      });
      instance.on('error', () =>
        setError(
          'Map tiles are unavailable. The listing controls and details remain usable.',
        ),
      );
    } catch {
      setError(
        'This browser cannot display the map. Use the listing controls instead.',
      );
    }
    return () => {
      if (instance && camera) {
        const center = instance.getCenter();
        camera.current = {
          center: [center.lng, center.lat],
          zoom: instance.getZoom(),
          bearing: instance.getBearing(),
          pitch: instance.getPitch(),
        };
      }
      for (const { marker } of markers.current) marker.remove();
      markers.current = [];
      instance?.remove();
      map.current = null;
    };
  }, [styleUrl, centerLongitude, centerLatitude, bounds, error, camera]);
  useEffect(() => {
    if (!map.current || appliedSatellite.current === satellite) return;
    appliedSatellite.current = satellite;
    map.current.setStyle(satellite ? SATELLITE_STYLE : styleUrl);
  }, [satellite, styleUrl]);
  useEffect(() => {
    if (!map.current || !loaded || error) return;
    const instance = map.current;
    function renderMarkers() {
      const previous = markers.current;
      const focused = previous.find(
        ({ button }) => button === document.activeElement,
      );
      const selected = selectedIdRef.current;
      const focusId =
        selected && focused?.ids.includes(selected)
          ? selected
          : focused?.ids[0];
      const existing = new Map(
        previous.map((entry) => [entry.group.key, entry]),
      );
      const created = clusterMapPoints(points, instance.getZoom()).map(
        (group) => {
          let entry = existing.get(group.key);
          if (!entry) {
            const button = document.createElement('button');
            button.type = 'button';
            entry = {
              group,
              button,
              ids: [],
              marker: new Marker({ element: button }),
            };
            const current = entry;
            button.addEventListener('click', () => {
              const { group } = current;
              if (group.nearby) {
                instance.easeTo({
                  center: [
                    group.coordinates.longitude,
                    group.coordinates.latitude,
                  ],
                  zoom: Math.min(
                    instance.getMaxZoom(),
                    clusterExpansionZoom(group, instance.getZoom()),
                  ),
                });
                return;
              }
              setStack(group.points.map((point) => point.id));
              if (
                group.points.length > 1 &&
                selectionRef.current.selectionMode
              ) {
                previewRef.current(group.points[0].id);
                openStackRef.current?.(group.points.map((point) => point.id));
              } else onSelectRef.current(group.points[0].id);
            });
          }
          entry.group = group;
          entry.ids = group.points.map((point) => point.id);
          const { button } = entry;
          // A shared marker dims only when every home on it is hidden.
          const dimmed = group.points.every((point) => point.dimmed);
          const savedByMe = group.points.some((point) => point.savedByMe);
          const savedByHousehold = group.points.some(
            (point) => point.savedByHousehold,
          );
          const savedCount = group.points.filter(
            (point) => point.savedByHousehold,
          ).length;
          button.classList.add(styles.marker);
          button.classList.toggle(styles.cluster, group.nearby);
          button.classList.toggle(styles.dimmed, dimmed);
          button.classList.toggle(styles.savedByMe, savedByMe);
          button.classList.toggle(
            styles.savedByHousehold,
            !savedByMe && savedByHousehold,
          );
          button.textContent =
            group.points.length === 1
              ? group.points[0].markerText
              : String(group.points.length);
          button.dataset.label =
            group.points.length === 1
              ? group.points[0].label
              : `${group.points.length} homes ${group.nearby ? 'nearby' : 'at this point'}${savedCount ? `, ${savedCount} saved by household${savedByMe ? ', including you' : ''}` : ''}${group.nearby ? '. Zoom in to explore' : ''}`;
          entry.marker.setLngLat([
            group.coordinates.longitude,
            group.coordinates.latitude,
          ]);
          if (!existing.has(group.key)) entry.marker.addTo(instance);
          return entry;
        },
      );
      const buttons = new Set(created.map(({ button }) => button));
      for (const entry of previous) {
        if (!buttons.has(entry.button)) entry.marker.remove();
      }
      markers.current = created;
      const batch = selectionRef.current;
      markPressed(
        created,
        selected,
        batch.selectionMode,
        batch.checkedIds,
        batch.selectionDisabled,
      );
      if (focused && !buttons.has(focused.button)) {
        const replacement =
          created.find(({ ids }) => focusId && ids.includes(focusId)) ??
          created.find(({ ids }) => ids.some((id) => focused.ids.includes(id)));
        (replacement?.button ?? instance.getCanvas()).focus({
          preventScroll: true,
        });
      }
    }
    renderMarkers();
    instance.on('zoomend', renderMarkers);
    return () => {
      instance.off('zoomend', renderMarkers);
    };
  }, [points, loaded, error]);
  // Only the pressed state changes on selection, so a focused marker stays focused.
  useEffect(() => {
    markPressed(
      markers.current,
      selectedId,
      selectionMode,
      checkedIds,
      selectionDisabled,
    );
  }, [selectedId, selectionMode, checkedIds, selectionDisabled]);
  useEffect(() => {
    const point = points.find((candidate) => candidate.id === selectedId);
    const instance = map.current;
    if (!point || point.unlocated || !instance || !loaded || error) return;
    const center: [number, number] = [
      point.coordinates.longitude,
      point.coordinates.latitude,
    ];
    const { clientWidth, clientHeight } = instance.getContainer();
    // The card sits over the bottom of the map, so the free area ends above it.
    const cardHeight =
      overlayRef.current?.firstElementChild?.getBoundingClientRect().height ??
      0;
    const cardInset = cardHeight ? cardHeight + CARD_GAP : 0;
    // Clear the corner controls only while a whole marker still fits between them and the card.
    const top = Math.min(
      controlsInset(controlsRef.current),
      Math.max(0, clientHeight - cardInset - 2 * MARKER_MARGIN - MARKER_SIZE),
    );
    const freeTop = Math.max(top, MARKER_MARGIN);
    const inset = cardInset
      ? Math.min(cardInset, clientHeight - freeTop - MARKER_MARGIN)
      : 0;
    const { x, y } = instance.project(center);
    const inFreeArea =
      x >= MARKER_MARGIN &&
      x <= clientWidth - MARKER_MARGIN &&
      y >= freeTop &&
      y <= clientHeight - inset - MARKER_MARGIN;
    // Keep the first view, which frames every marker, when the pin is already in sight.
    if (!inFreeArea)
      instance.jumpTo({ center, padding: { top, bottom: inset } });
  }, [points, selectedId, loaded, error]);
  // Escape with focus anywhere in the map area (markers, controls, the card) clears the selection.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || selectedId === null) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onDeselectRef.current();
    };
    stage.addEventListener('keydown', close);
    return () => stage.removeEventListener('keydown', close);
  }, [selectedId]);
  function captureView() {
    const instance = map.current;
    if (!instance || !loaded || captureDisabled || !onCaptureView) return;
    const mapElement = instance.getContainer();
    const mapRect = mapElement.getBoundingClientRect();
    const obscured = [
      controlsRef.current,
      pickerRef.current,
      overlayRef.current?.firstElementChild,
      ...mapElement.querySelectorAll('.maplibregl-ctrl'),
    ].flatMap((element) => {
      if (!element) return [];
      const rect = element.getBoundingClientRect();
      if (!rect.width || !rect.height) return [];
      return [
        {
          left: rect.left - mapRect.left - MARKER_MARGIN,
          top: rect.top - mapRect.top - MARKER_MARGIN,
          right: rect.right - mapRect.left + MARKER_MARGIN,
          bottom: rect.bottom - mapRect.top + MARKER_MARGIN,
        },
      ];
    });
    onCaptureView(
      mapSelectionIds(
        points,
        ({ longitude, latitude }) => instance.project([longitude, latitude]),
        {
          left: MARKER_MARGIN,
          top: MARKER_MARGIN,
          right: mapElement.clientWidth - MARKER_MARGIN,
          bottom: mapElement.clientHeight - MARKER_MARGIN,
        },
        obscured,
      ),
    );
  }
  const hasOverlay = overlay != null;
  // The phone sheet covers the bottom edge, so the tile attribution rides above it.
  useEffect(() => {
    const stage = stageRef.current;
    const card = overlayRef.current?.firstElementChild;
    if (!hasOverlay || !stage || !card) return;
    const observer = new ResizeObserver(() =>
      stage.style.setProperty(
        '--card-height',
        `${card.getBoundingClientRect().height}px`,
      ),
    );
    observer.observe(card);
    return () => {
      observer.disconnect();
      stage.style.removeProperty('--card-height');
    };
  }, [hasOverlay]);
  useEffect(() => {
    const element = container.current;
    if (!element || error) return;
    const observer = new ResizeObserver(() => map.current?.resize());
    observer.observe(element);
    return () => observer.disconnect();
  }, [error]);
  const provider = satellite ? 'Esri' : 'OpenFreeMap';
  const availableStack =
    selectedId !== null && stack.includes(selectedId)
      ? stack.filter((id) => points.some((point) => point.id === id))
      : [];
  const count = availableStack.length;
  const at = Math.max(0, availableStack.indexOf(selectedId ?? ''));
  return (
    <Stack gap="sm" className={fillMobile ? styles.fillMobile : undefined}>
      {error && <Text role="alert">{error}</Text>}
      {!error && !loaded && <Text role="status">Loading map…</Text>}
      <div ref={stageRef} className={styles.stage}>
        <section
          ref={container}
          className={styles.map}
          aria-label="Listing map"
        />
        {(controls || onCaptureView || unlocated.length > 0) && (
          <div ref={controlsRef} className={styles.controls}>
            <Stack gap="xs">
              {controls}
              <MapPinGuide />
              {onCaptureView && (
                <Button
                  size="xs"
                  variant="default"
                  disabled={!loaded || captureDisabled || Boolean(error)}
                  onClick={(event) => {
                    event.stopPropagation();
                    captureView();
                  }}
                >
                  Review this area
                </Button>
              )}
              {unlocated.length > 0 && (
                <Popover
                  opened={unlocatedOpen}
                  onChange={setUnlocatedOpen}
                  position="bottom-start"
                  width="min(340px, calc(100vw - 48px))"
                  trapFocus
                >
                  <Popover.Target>
                    <Button
                      size="xs"
                      variant="default"
                      aria-expanded={unlocatedOpen}
                      aria-haspopup="dialog"
                      onClick={() => setUnlocatedOpen((open) => !open)}
                    >
                      Not located ({unlocated.length})
                    </Button>
                  </Popover.Target>
                  <Popover.Dropdown
                    ref={pickerRef}
                    role="dialog"
                    aria-label="Not located homes"
                    className={styles.unlocatedPicker}
                  >
                    <Stack gap="xs">
                      <Text size="sm">These homes have no known position.</Text>
                      {unlocated.map((point) => (
                        <Button
                          key={point.id}
                          variant={
                            (
                              selectionMode
                                ? checkedIds.has(point.id)
                                : point.id === selectedId
                            )
                              ? 'filled'
                              : 'default'
                          }
                          aria-pressed={
                            selectionMode
                              ? checkedIds.has(point.id)
                              : point.id === selectedId
                          }
                          disabled={
                            selectionMode &&
                            (selectionDisabled ||
                              point.dimmed === true ||
                              (checkedIds.size >= 500 &&
                                !checkedIds.has(point.id)))
                          }
                          className={styles.unlocatedChoice}
                          onClick={() => {
                            setStack([]);
                            onSelect(point.id);
                            setUnlocatedOpen(false);
                          }}
                        >
                          {point.savedByMe
                            ? '★ '
                            : point.savedByHousehold
                              ? '☆ '
                              : ''}
                          {point.label}
                        </Button>
                      ))}
                    </Stack>
                  </Popover.Dropdown>
                </Popover>
              )}
              {located.length === 0 && unlocated.length > 0 && (
                <Text size="xs" className={styles.noPositions}>
                  These homes have no known position. Choose Not located to view
                  their details.
                </Text>
              )}
            </Stack>
          </div>
        )}
        {/* Measured for the card height; the card keeps its own absolute position. */}
        <div ref={overlayRef}>{overlay}</div>
      </div>
      {availableStack.length > 1 && (
        <Group
          aria-label="Homes at selected point"
          className={styles.stackNavigation}
        >
          {availableStack.length > MAX_STACK_BUTTONS ? (
            <>
              <Button
                size="xs"
                variant="default"
                onClick={() =>
                  onPreview(availableStack[(at - 1 + count) % count])
                }
              >
                Previous
              </Button>
              <Text size="sm">
                Home {at + 1} of {count}
              </Text>
              <Button
                size="xs"
                variant="default"
                onClick={() => onPreview(availableStack[(at + 1) % count])}
              >
                Next
              </Button>
            </>
          ) : (
            availableStack.map((id, index) => (
              <Button
                key={id}
                size="xs"
                variant={id === selectedId ? 'filled' : 'default'}
                onClick={() => onPreview(id)}
              >
                Home {index + 1}
              </Button>
            ))
          )}
        </Group>
      )}
      <Text size="xs" c="dimmed">
        Map tiles come from {provider}, which sees your address and the area you
        view.
      </Text>
    </Stack>
  );
}
