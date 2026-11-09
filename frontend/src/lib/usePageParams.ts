import { useCallback } from 'react';
import { useSearchParam, useSearchUpdate } from './router';

export const DEFAULT_PAGE_SIZE = 10;
export const PAGE_SIZES = [10, 25, 50, 100];

/**
 * The page a list is on, kept in the address so refresh and the back button keep it.
 * Give each list on a screen its own key when there is more than one.
 */
export function usePageParams(key = '') {
  const pageName = key ? `${key}-page` : 'page';
  const sizeName = key ? `${key}-size` : 'size';
  const [pageValue] = useSearchParam(pageName);
  const [sizeValue] = useSearchParam(sizeName);
  const update = useSearchUpdate();
  const page = Math.max(Number(pageValue) || 1, 1);
  const pageSize = PAGE_SIZES.includes(Number(sizeValue)) ? Number(sizeValue) : DEFAULT_PAGE_SIZE;
  const setPage = useCallback((next: number) => update({ [pageName]: next > 1 ? String(next) : '' }), [update, pageName]);
  const setPageSize = useCallback((next: number) => update({ [sizeName]: next === DEFAULT_PAGE_SIZE ? '' : String(next), [pageName]: '' }), [update, sizeName, pageName]);
  return { page, pageSize, setPage, setPageSize, pageName };
}
