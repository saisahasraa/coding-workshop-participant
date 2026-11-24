import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';

/**
 * List state (search, filters, sort, paging) kept in the URL, so views are shareable and
 * survive reloads. Returns the API query plus setters.
 *
 * @param {{pageSize?: number, sort?: string, filters?: string[]}} [options]
 */
export default function useListQuery({ pageSize: defaultSize = 25, sort: defaultSort = '', filters = [] } = {}) {
  const [params, setParams] = useSearchParams();
  const page = Math.max(0, Number(params.get('page') || 0));
  const pageSize = Number(params.get('size') || defaultSize);
  const sort = params.get('sort') ?? defaultSort;
  const q = params.get('q') || '';
  const filterKey = filters.join(',');

  const values = useMemo(
    () => Object.fromEntries(filterKey.split(',').filter(Boolean).map((name) => [name, params.get(name) || ''])),
    [params, filterKey],
  );

  const update = useCallback((changes, resetPage = true) => {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      Object.entries(changes).forEach(([key, value]) => {
        if (value === '' || value === null || value === undefined) next.delete(key);
        else next.set(key, String(value));
      });
      if (resetPage && !('page' in changes)) next.delete('page');
      return next;
    }, { replace: true });
  }, [setParams]);

  const query = useMemo(() => ({
    ...values, q, sort: sort || undefined, limit: pageSize, offset: page * pageSize,
  }), [values, q, sort, page, pageSize]);

  return {
    query,
    q,
    values,
    sort,
    page,
    pageSize,
    setSearch: (text) => update({ q: text }),
    setFilter: (name, value) => update({ [name]: value }),
    setSort: (value) => update({ sort: value }),
    setPage: (value) => update({ page: value || '' }, false),
    setPageSize: (value) => update({ size: value }),
  };
}
