import { useCallback, useEffect, useState } from 'react';

/**
 * Run an async loader on mount and on `reload()`, cancelling in-flight calls on unmount.
 *
 * @param {(signal: AbortSignal) => Promise<*>} loader Must be stable (module-level or memoized).
 * @returns {{data: *, error: ?Error, loading: boolean, reload: () => void, setData: (data: *) => void}}
 */
export default function useApi(loader) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    loader(controller.signal).then(
      (data) => {
        if (!controller.signal.aborted) setState({ data, error: null, loading: false });
      },
      (error) => {
        if (!controller.signal.aborted) setState((prev) => ({ data: prev.data, error, loading: false }));
      },
    );
    return () => controller.abort();
  }, [loader, version]);

  const reload = useCallback(() => {
    setState((prev) => ({ ...prev, loading: true }));
    setVersion((v) => v + 1);
  }, []);

  const setData = useCallback((data) => setState((prev) => ({ ...prev, data })), []);

  return { ...state, reload, setData };
}
