'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Plate history, now the search on the Vehicle log (it went into Find a vehicle
 * first, which then moved there too).
 *
 * Kept as a redirect rather than deleted: this URL is in browser histories and
 * very likely in somebody's bookmarks bar, and a 404 on a page that worked
 * yesterday reads as the portal being broken rather than as a screen having
 * moved. The log's search answers the same question from less typing.
 */
export default function PlateHistoryMoved() {
  const router = useRouter();
  useEffect(() => { router.replace('/valet/visits'); }, [router]);

  return (
    <div className="p-8">
      <p className="text-sm text-gray-500">
        Plate history now lives in the Vehicle log — search any part of the plate, then
        choose “All visits”. Taking you there…
      </p>
    </div>
  );
}
