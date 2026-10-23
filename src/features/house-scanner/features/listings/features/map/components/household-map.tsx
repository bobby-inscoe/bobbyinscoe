import { ActionIcon, Button, Group, Popover, Stack, Text } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { Settings2, Star } from 'lucide-react';
import type { StyleSpecification } from 'maplibre-gl';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { FormattedMessage, type IntlShape, useIntl } from 'react-intl';
import { MapPinGuide } from '@/features/house-scanner/features/listings/features/map/components/map-pin-guide';
import {
  clusterExpansionZoom,
  clusterMapPoints,
  isolationZoom,
  type MapGroup,
} from '@/features/house-scanner/features/listings/features/map/utils/map-clusters';
import { mapSelectionIds } from '@/features/house-scanner/features/listings/features/map/utils/map-selection';
import {
  englishIntl,
  type Feedback,
  formatFeedback,
  messageValue,
} from '@/features/house-scanner/i18n/catalogs';
import { classes } from '@/features/house-scanner/theme/shellter-theme';
import type { MapPoint } from '@/features/house-scanner/utils/listing-view';
import {
  retainMap,
  STREET_STYLE,
} from '@/features/house-scanner/utils/map-runtime';
import {
  Map as MapLibreMap,
  Marker,
  NavigationControl,
} from '@/features/house-scanner/utils/map-runtime-module';

const MAX_STACK_BUTTONS = 6;
// Room kept around a pin so its marker is not clipped, and between the card and the map edge.
const MARKER_MARGIN = 24;
const CARD_GAP = 24;
// Minimum marker size on coarse pointers.
const MARKER_SIZE = 44;
const MOBILE_CONTROLS_INSET = 200;

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
  intl: IntlShape = englishIntl,
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
        ? intl.formatMessage(
            { id: 'listings.map.markerSelection' },
            { label, count: checked, single: ids.length === 1 ? 'yes' : 'no' },
          )
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
  styleUrl = STREET_STYLE,
  satellite = false,
  fillMobile = false,
  overlay,
  controls,
  onCaptureView,
  captureDisabled = false,
  camera,
}: HouseholdMapProps) {
  const intl = useIntl();

  const initialLocale = useRef({
    'Map.Title': intl.formatMessage({ id: 'listings.list.map' }),
    'NavigationControl.ZoomIn': intl.formatMessage({
      id: 'listings.map.zoomIn',
    }),
    'NavigationControl.ZoomOut': intl.formatMessage({
      id: 'listings.map.zoomOut',
    }),
    'NavigationControl.ResetBearing': intl.formatMessage({
      id: 'listings.map.resetBearing',
    }),
    'AttributionControl.ToggleAttribution': intl.formatMessage({
      id: 'listings.map.toggleAttribution',
    }),
  });
  const container = useRef<HTMLElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const [error, setError] = useState<Feedback>('');
  const [loaded, setLoaded] = useState(false);
  const [overlayHeight, setOverlayHeight] = useState(0);
  const [stack, setStack] = useState<string[]>([]);
  const [unlocatedOpen, setUnlocatedOpen] = useState(false);
  const [mobileOptionsOpen, setMobileOptionsOpen] = useState(false);
  const mobile = useMediaQuery('(max-width: 36em)');
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
  // A home already selected when the map opens came from See on map, so frame it up close once.
  const zoomToId = useRef(selectedId);
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
    const phoneLayout = window.matchMedia('(max-width: 36em)').matches;
    let instance: MapLibreMap | null = null;
    const release = retainMap();
    try {
      const savedCamera = camera?.current;
      instance = new MapLibreMap({
        container: container.current,
        locale: initialLocale.current,
        style: satelliteRef.current ? SATELLITE_STYLE : styleUrl,
        center: savedCamera?.center ?? [centerLongitude, centerLatitude],
        zoom: savedCamera?.zoom ?? 11,
        bearing: savedCamera?.bearing ?? 0,
        pitch: savedCamera?.pitch ?? 0,
        ...(savedCamera ? {} : { bounds }),
        fitBoundsOptions: {
          padding: {
            top: phoneLayout
              ? MOBILE_CONTROLS_INSET
              : Math.max(56, controlsInset(controlsRef.current)),
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
        if (target instanceof Element && target.closest(`.${classes.marker}`))
          return;
        onDeselectRef.current();
      });
      instance.on('error', () =>
        setError(
          'listings.map.mapTilesAreUnavailableTheListingControlsAndDetails',
        ),
      );
    } catch {
      setError('listings.map.thisBrowserCannotDisplayTheMapUseTheListing');
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
      release();
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
    function renderMarkers(expanding = false) {
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
            const markerElement = document.createElement('div');
            markerElement.className = classes.markerRoot;
            const button = document.createElement('button');
            button.type = 'button';
            markerElement.append(button);
            entry = {
              group,
              button,
              ids: [],
              marker: new Marker({ element: markerElement }),
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
          button.classList.add(classes.marker);
          button.classList.toggle(classes.cluster, group.nearby);
          button.classList.toggle(classes.dimmed, dimmed);
          button.classList.toggle(classes.savedByMe, savedByMe);
          button.classList.toggle(
            classes.savedByHousehold,
            !savedByMe && savedByHousehold,
          );
          button.textContent =
            group.points.length === 1
              ? group.points[0].markerText
              : String(group.points.length);
          button.dataset.label =
            group.points.length === 1
              ? group.points[0].label
              : intl.formatMessage(
                  { id: 'listings.map.groupLabel' },
                  {
                    count: group.points.length,
                    nearby: group.nearby ? 'yes' : 'no',
                    saved: savedCount,
                    mine: savedByMe ? 'yes' : 'no',
                  },
                );
          entry.marker.setLngLat([
            group.coordinates.longitude,
            group.coordinates.latitude,
          ]);
          if (!existing.has(group.key)) {
            entry.marker.addTo(instance);
            const source = expanding
              ? previous.find(
                  (candidate) =>
                    candidate.group.nearby &&
                    candidate.ids.length > group.points.length &&
                    group.points.some((point) =>
                      candidate.ids.includes(point.id),
                    ),
                )
              : undefined;
            if (
              source &&
              !window.matchMedia('(prefers-reduced-motion: reduce)').matches
            ) {
              const origin = instance.project([
                source.group.coordinates.longitude,
                source.group.coordinates.latitude,
              ]);
              const destination = instance.project([
                group.coordinates.longitude,
                group.coordinates.latitude,
              ]);
              button.animate(
                [
                  {
                    transform: `translate(${origin.x - destination.x}px, ${origin.y - destination.y}px) scale(.8)`,
                    opacity: 0.6,
                  },
                  { transform: 'translate(0, 0) scale(1)', opacity: 1 },
                ],
                { duration: 420, easing: 'cubic-bezier(.2, .8, .2, 1)' },
              );
            }
          }
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
        intl,
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
    let previousZoom = instance.getZoom();
    renderMarkers();
    function renderAfterZoom() {
      const zoom = instance.getZoom();
      const expanding = zoom > previousZoom;
      previousZoom = zoom;
      renderMarkers(expanding);
    }
    instance.on('zoomend', renderAfterZoom);
    return () => {
      instance.off('zoomend', renderAfterZoom);
    };
  }, [points, loaded, error, intl]);
  useEffect(() => {
    const element = container.current;
    if (!element || !loaded) return;
    const controls = [
      ['.maplibregl-ctrl-zoom-in', 'listings.map.zoomIn'],
      ['.maplibregl-ctrl-zoom-out', 'listings.map.zoomOut'],
      ['.maplibregl-ctrl-compass', 'listings.map.resetBearing'],
      ['.maplibregl-ctrl-attrib-button', 'listings.map.toggleAttribution'],
    ] as const;
    for (const [selector, id] of controls) {
      const control = element.querySelector(selector);
      const label = intl.formatMessage({ id });
      control?.setAttribute('aria-label', label);
      control?.setAttribute('title', label);
    }
    element
      .querySelector('canvas')
      ?.setAttribute(
        'aria-label',
        intl.formatMessage({ id: 'listings.list.map' }),
      );
  }, [intl, loaded]);
  // Only the pressed state changes on selection, so a focused marker stays focused.
  useEffect(() => {
    markPressed(
      markers.current,
      selectedId,
      selectionMode,
      checkedIds,
      selectionDisabled,
      intl,
    );
  }, [selectedId, selectionMode, checkedIds, selectionDisabled, intl]);
  const latestPoints = useRef(points);
  latestPoints.current = points;
  const selectedPosition = points.find(
    (point) => point.id === selectedId,
  )?.coordinates;
  const selectedLongitude = selectedPosition?.longitude;
  const selectedLatitude = selectedPosition?.latitude;
  // Label changes must not reframe a selected home after the user has panned away.
  useEffect(() => {
    const instance = map.current;
    if (
      !selectedId ||
      selectedLongitude === undefined ||
      selectedLatitude === undefined ||
      !instance ||
      !loaded ||
      error
    )
      return;
    const center: [number, number] = [selectedLongitude, selectedLatitude];
    const { clientWidth, clientHeight } = instance.getContainer();
    // The card sits over the bottom of the map, so the free area ends above it.
    const cardHeight = overlayHeight;
    const cardInset = cardHeight ? cardHeight + CARD_GAP : 0;
    // Clear the corner controls only while a whole marker still fits between them and the card.
    const top = Math.min(
      window.matchMedia('(max-width: 36em)').matches
        ? MOBILE_CONTROLS_INSET
        : controlsInset(controlsRef.current),
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
    if (zoomToId.current === selectedId) {
      zoomToId.current = null;
      instance.jumpTo({
        center,
        zoom: Math.min(
          instance.getMaxZoom(),
          Math.max(
            instance.getZoom(),
            isolationZoom(latestPoints.current, selectedId),
          ),
        ),
        padding: { top, bottom: inset },
      });
      return;
    }
    // Keep the first view, which frames every marker, when the pin is already in sight.
    if (!inFreeArea)
      instance.jumpTo({ center, padding: { top, bottom: inset } });
  }, [
    selectedId,
    selectedLongitude,
    selectedLatitude,
    loaded,
    error,
    overlayHeight,
  ]);
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
    let frame = 0;
    const observer = new ResizeObserver(() => {
      const height = card.getBoundingClientRect().height;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        setOverlayHeight(height);
        stage.style.setProperty('--card-height', `${height}px`);
      });
    });
    observer.observe(card);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      stage.style.removeProperty('--card-height');
    };
  }, [hasOverlay]);
  useEffect(() => {
    const element = container.current;
    if (!element || error) return;
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => map.current?.resize());
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [error]);
  const mapOptions = (
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
            setMobileOptionsOpen(false);
            if (mobile) requestAnimationFrame(captureView);
            else captureView();
          }}
        >
          <FormattedMessage id="listings.map.reviewThisArea" />
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
              <FormattedMessage
                id="listings.map.notLocated"
                values={{ value0: messageValue(unlocated.length) }}
              />
            </Button>
          </Popover.Target>
          <Popover.Dropdown
            ref={pickerRef}
            role="dialog"
            aria-label={intl.formatMessage({
              id: 'listings.map.notLocatedHomes',
            })}
            className={classes.unlocatedPicker}
          >
            <Stack gap="xs">
              <Text size="sm">
                <FormattedMessage id="listings.map.theseHomesHaveNoKnownPosition" />
              </Text>
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
                      (checkedIds.size >= 500 && !checkedIds.has(point.id)))
                  }
                  className={classes.unlocatedChoice}
                  onClick={() => {
                    setStack([]);
                    onSelect(point.id);
                    setUnlocatedOpen(false);
                    setMobileOptionsOpen(false);
                  }}
                >
                  {(point.savedByMe || point.savedByHousehold) && (
                    <Star
                      size={14}
                      fill={point.savedByMe ? 'currentColor' : 'none'}
                      aria-label={
                        point.savedByMe
                          ? intl.formatMessage({
                              id: 'listings.map.savedByYou',
                            })
                          : intl.formatMessage({
                              id: 'listings.map.savedByHousehold',
                            })
                      }
                      className={classes.inlineIcon}
                    />
                  )}
                  {point.label}
                </Button>
              ))}
            </Stack>
          </Popover.Dropdown>
        </Popover>
      )}
      {located.length === 0 && unlocated.length > 0 && (
        <Text size="xs" className={classes.noPositions}>
          <FormattedMessage id="listings.map.theseHomesHaveNoKnownPositionChooseNotLocated" />
        </Text>
      )}
    </Stack>
  );
  const availableStack =
    selectedId !== null && stack.includes(selectedId)
      ? stack.filter((id) => points.some((point) => point.id === id))
      : [];
  const count = availableStack.length;
  const at = Math.max(0, availableStack.indexOf(selectedId ?? ''));
  return (
    <Stack gap="sm" className={fillMobile ? classes.fillMobile : undefined}>
      {error && <Text role="alert">{formatFeedback(intl, error)}</Text>}
      {!error && !loaded && (
        <Text role="status">
          <FormattedMessage id="listings.map.loadingMap" />
        </Text>
      )}
      <div ref={stageRef} className={classes.stage}>
        <section
          ref={container}
          className={classes.map}
          aria-label={intl.formatMessage({ id: 'listings.map.listingMap' })}
        />
        {(controls || onCaptureView || unlocated.length > 0) && (
          <div ref={controlsRef} className={classes.controls}>
            {mobile ? (
              <Popover
                opened={mobileOptionsOpen}
                onChange={setMobileOptionsOpen}
                position="bottom-end"
              >
                <Popover.Target>
                  <ActionIcon
                    variant="default"
                    data-map-options
                    aria-label={intl.formatMessage({
                      id: 'listings.map.mapOptions',
                    })}
                    aria-expanded={mobileOptionsOpen}
                    aria-haspopup="dialog"
                    onClick={() => setMobileOptionsOpen((open) => !open)}
                  >
                    <Settings2 size={20} aria-hidden="true" />
                  </ActionIcon>
                </Popover.Target>
                <Popover.Dropdown
                  role="dialog"
                  data-map-options
                  aria-label={intl.formatMessage({
                    id: 'listings.map.mapOptions',
                  })}
                >
                  {mapOptions}
                </Popover.Dropdown>
              </Popover>
            ) : (
              mapOptions
            )}
          </div>
        )}
        {/* Measured for the card height; the card keeps its own absolute position. */}
        <div ref={overlayRef}>{overlay}</div>
      </div>
      {availableStack.length > 1 && (
        <Group
          aria-label={intl.formatMessage({
            id: 'listings.map.homesAtSelectedPoint',
          })}
          className={classes.stackNavigation}
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
                <FormattedMessage id="common.previous" />
              </Button>
              <Text size="sm">
                <FormattedMessage
                  id="listings.map.homeOf"
                  values={{
                    value0: messageValue(at + 1),
                    value1: messageValue(count),
                  }}
                />
              </Text>
              <Button
                size="xs"
                variant="default"
                onClick={() => onPreview(availableStack[(at + 1) % count])}
              >
                <FormattedMessage id="common.next" />
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
                <FormattedMessage
                  id="listings.map.home"
                  values={{ value0: messageValue(index + 1) }}
                />
              </Button>
            ))
          )}
        </Group>
      )}
    </Stack>
  );
}
