'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { Location, listLocations, selectCommunity, selectedCommunity } from '@/lib/valet';

/**
 * Which hotel of the group every screen is showing, and how to change it.
 *
 * The design puts this in the top bar rather than on the Properties page, and
 * that placement is the whole point: a group admin who opened Whitefield and
 * then walked to the Vehicle log had no way back to the group and no reminder
 * of whose numbers they were reading. A back link on one page does not fix
 * that; it has to be wherever they end up.
 *
 * Only a client_admin sees it. A manager of one property has no choice to
 * make, and a selector of one is furniture implying otherwise.
 */
export default function PropertySwitcher() {
  const { user } = useAuth();
  const [locations, setLocations] = useState<Location[] | null>(null);
  const [current, setCurrent] = useState<string>('');

  useEffect(() => {
    if (user?.role !== 'client_admin') return;
    setCurrent(selectedCommunity() ?? '');
    listLocations()
      .then((r) => setLocations(r.locations))
      // Silent: the header is not the place to report that a list failed, and
      // every screen under it still works scoped to whatever is selected.
      .catch(() => setLocations(null));
  }, [user?.role]);

  if (user?.role !== 'client_admin' || !locations || locations.length === 0) return null;

  return (
    <select
      aria-label="Property"
      value={current}
      onChange={(e) => {
        selectCommunity(e.target.value || null);
        // A full load, not a router push: every screen reads the selection when
        // it fetches, so a client-side navigation would leave the previous
        // property's numbers on screen under the new property's name.
        window.location.reload();
      }}
      className="input-glow px-3 py-1.5 text-sm font-semibold max-w-[260px]"
    >
      <option value="">All properties</option>
      {locations.map((l) => (
        <option key={l.id} value={l.id}>{l.name}</option>
      ))}
    </select>
  );
}
