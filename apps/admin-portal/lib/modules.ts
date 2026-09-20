'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from './api';

/** gate = Nazar, community = Basera, valet = DwaarAI Valet. */
export const ALL_MODULES = ['gate', 'community', 'valet'];

/**
 * Which products this property bought.
 *
 * Every default here points at "everything", deliberately. A missing
 * entitlements row, a null column, a slow request or a failed one all resolve
 * to the full set — because the failure mode of getting this wrong is blanking
 * a working customer's portal, and that looks identical to losing access.
 */
export function useModules(): { modules: string[]; valetOnly: boolean } {
  const [modules, setModules] = useState<string[]>(ALL_MODULES);

  useEffect(() => {
    let cancelled = false;
    apiFetch<{ data?: { modules?: string[] } }>('/entitlements')
      .then((res) => {
        const found = res?.data?.modules;
        if (!cancelled && found?.length) setModules(found);
      })
      .catch(() => {
        /* A property we cannot ask keeps the portal it had. */
      });
    return () => { cancelled = true; };
  }, []);

  return {
    modules,
    valetOnly: modules.length === 1 && modules[0] === 'valet',
  };
}
