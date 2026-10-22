import { useEffect, useMemo, useRef, useState } from 'react';
import {
  type ListingSort,
  sortListings,
} from '@/features/house-scanner/features/listings/features/list/utils/listing-sort';
import type { Listing } from '@/features/house-scanner/types/contracts';

const LIST_BATCH_SIZE = 32;

export function useListBatching(
  visible: Listing[],
  sort: ListingSort,
  view: 'list' | 'map',
) {
  const [listRender, setListRender] = useState({
    visible,
    sort,
    count: LIST_BATCH_SIZE,
  });
  const listEnd = useRef<HTMLDivElement>(null);
  const ordered = useMemo(() => sortListings(visible, sort), [visible, sort]);
  const renderedCount =
    listRender.visible === visible && listRender.sort === sort
      ? listRender.count
      : LIST_BATCH_SIZE;
  useEffect(() => {
    if (view !== 'list' || renderedCount >= ordered.length || !listEnd.current)
      return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting)
          setListRender({
            visible,
            sort,
            count: Math.min(renderedCount + LIST_BATCH_SIZE, ordered.length),
          });
      },
      { rootMargin: '600px' },
    );
    observer.observe(listEnd.current);
    return () => observer.disconnect();
  }, [view, renderedCount, ordered.length, visible, sort]);
  return { ordered, renderedCount, listEnd };
}
