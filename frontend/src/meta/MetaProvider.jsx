import { useEffect, useMemo, useState } from 'react';
import PropTypes from 'prop-types';
import { fetchMeta } from '../api/resources';
import { useAuth } from '../auth/AuthContext';
import { DEFAULT_APP_NAME } from '../config';
import { MetaContext } from './MetaContext';

/** Loads runtime metadata once signed in, so admin setting changes reach the UI without a rebuild. */
export default function MetaProvider({ children }) {
  const { status } = useAuth();
  const [meta, setMeta] = useState(null);

  useEffect(() => {
    if (status !== 'authenticated') return undefined;
    const controller = new AbortController();
    fetchMeta(controller.signal).then(setMeta).catch(() => {});
    return () => controller.abort();
  }, [status]);

  const value = useMemo(() => ({
    meta,
    appName: meta?.settings?.['app.name'] || DEFAULT_APP_NAME,
    currency: meta?.settings?.['budget.currency'] || 'USD',
  }), [meta]);

  return <MetaContext.Provider value={value}>{children}</MetaContext.Provider>;
}

MetaProvider.propTypes = {
  children: PropTypes.node,
};
