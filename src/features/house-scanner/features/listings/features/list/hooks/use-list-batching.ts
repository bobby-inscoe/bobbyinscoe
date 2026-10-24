import { useEffect, useMemo, useRef, useState } from 'react';
import {
  type ListingSort,
  sortListings,
} from '@/features/house-scanner/features/listings/features/list/utils/listing-sort';
import type { Listing } from '@/features/house-scanner/types/contracts';

// A phone shows one or two cards, so it builds 8 at a time; wider screens fill a grid.
const batchSize = () =>
  window.matchMedia('(max-width: 35.99375em)').matches ? 8 : 32;

export function useListBatching(
  visible: Listing[],
  sort: ListingSort,
  view: 'list' | 'map',
) {
  const [size] = useState(batchSize);
  const [listRender, setListRender] = useState({
    visible,
    sort,
    count: size,
  });
  const listEnd = useRef<HTMLDivElement>(null);
  const ordered = useMemo(() => sortListings(visible, sort), [visible, sort]);
  const renderedCount =
    listRender.visible === visible && listRender.sort === sort
      ? listRender.count
      : size;
  useEffect(() => {
    if (view !== 'list' || renderedCount >= ordered.length || !listEnd.current)
      return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting)
          setListRender({
            visible,
            sort,
            count: Math.min(renderedCount + size, ordered.length),
          });
      },
      { rootMargin: '600px' },
    );
    observer.observe(listEnd.current);
    return () => observer.disconnect();
  }, [view, renderedCount, ordered.length, visible, sort, size]);
  return { ordered, renderedCount, listEnd };
}
