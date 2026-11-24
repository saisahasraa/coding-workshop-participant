import { createContext, useContext } from 'react';

export const MetaContext = createContext({ meta: null, appName: '', currency: 'USD' });

/** Enumerations and public runtime settings from `GET /meta`. */
export const useMeta = () => useContext(MetaContext);
