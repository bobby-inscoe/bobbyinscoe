import { Text, UnstyledButton } from '@mantine/core';
import type { Map as MapLibreMap, Marker } from 'maplibre-gl';
import {
  type RefObject,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { FormattedMessage, useIntl } from 'react-intl';
import { classes } from '@/features/house-scanner/theme/shellter-theme';
import type { Listing } from '@/features/house-scanner/types/contracts';
import {
  loadMapRuntime,
  retainMap,
  STREET_STYLE,
} from '@/features/house-scanner/utils/map-runtime';

interface LocationPreviewProps {
  coordinates: NonNullable<Listing['coordinates']>;
  styleUrl?: string;
  ready: boolean;
  viewport: RefObject<HTMLDivElement | null>;
  onActivate?: () => void;
}

export function LocationPreview({
  coordinates,
  styleUrl = STREET_STYLE,
  ready,
  viewport,
  onActivate,
}: LocationPreviewProps) {
  const intl = useIntl();
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const marker = useRef<Marker | null>(null);
  const position = useRef(coordinates);
  position.current = coordinates;
  const [near, setNear] = useState(false);
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed'>(
    'loading',
  );

  useEffect(() => {
    if (!ready || !container.current) return;
    if (!('IntersectionObserver' in window)) {
      setNear(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setNear(true);
          observer.disconnect();
        }
      },
      { root: viewport.current, rootMargin: '160px' },
    );
    observer.observe(container.current);
    return () => observer.disconnect();
  }, [ready, viewport]);

  useEffect(() => {
    if (!ready || !near) return;
    let disposed = false;
    let failed = false;
    let instance: MapLibreMap | undefined;
    let release: (() => void) | undefined;
    setStatus('loading');
    // A stalled provider must eventually settle, even if it never raises an error event.
    const timeout = setTimeout(() => {
      fail();
    }, 15000);
    const fail = () => {
      if (!disposed) {
        failed = true;
        clearTimeout(timeout);
        setStatus('failed');
      }
    };
    void loadMapRuntime().then((runtime) => {
      if (disposed || !container.current) return;
      release = retainMap();
      try {
        const { longitude, latitude } = position.current;
        instance = new runtime.Map({
          container: container.current,
          style: styleUrl,
          center: [longitude, latitude],
          zoom: 14,
          interactive: false,
          attributionControl: { compact: false },
          fadeDuration: 0,
        });
        map.current = instance;
        marker.current = new runtime.Marker({
          color: 'var(--mantine-primary-color-filled)',
        })
          .setLngLat([longitude, latitude])
          .addTo(instance);
        instance.on('error', fail);
        instance.once('idle', () => {
          if (!disposed && !failed) {
            clearTimeout(timeout);
            setStatus('ready');
          }
        });
      } catch {
        fail();
      }
    }, fail);
    return () => {
      disposed = true;
      clearTimeout(timeout);
      marker.current?.remove();
      marker.current = null;
      instance?.remove();
      map.current = null;
      release?.();
    };
  }, [ready, near, styleUrl]);

  useLayoutEffect(() => {
    const center: [number, number] = [
      coordinates.longitude,
      coordinates.latitude,
    ];
    const instance = map.current;
    if (!instance) return;
    let failed = false;
    setStatus('loading');
    const loaded = () => {
      if (!failed) {
        clearTimeout(timeout);
        setStatus('ready');
      }
    };
    const fail = () => {
      failed = true;
      clearTimeout(timeout);
      setStatus('failed');
    };
    const timeout = setTimeout(fail, 15000);
    instance.once('idle', loaded);
    instance.on('error', fail);
    marker.current?.setLngLat(center);
    instance.jumpTo({ center });
    return () => {
      clearTimeout(timeout);
      instance.off('idle', loaded);
      instance.off('error', fail);
    };
  }, [coordinates.longitude, coordinates.latitude]);

  return (
    <div className={classes.locationPreview} data-preview-state={status}>
      <div ref={container} className={classes.locationPreviewMap} />
      {onActivate && (
        <UnstyledButton
          className={classes.locationPreviewAction}
          onClick={onActivate}
          aria-label={intl.formatMessage({
            id: 'listings.details.openLocationMap',
          })}
        />
      )}
      {status !== 'ready' && (
        <Text className={classes.locationPreviewStatus} size="sm" role="status">
          <FormattedMessage
            id={
              status === 'failed'
                ? 'listings.details.locationMapUnavailable'
                : 'listings.details.loadingLocationMap'
            }
          />
        </Text>
      )}
    </div>
  );
}
