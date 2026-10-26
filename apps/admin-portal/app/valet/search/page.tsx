'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Find a vehicle, now the search box on the Vehicle log.
 *
 * Kept as a redirect rather than deleted: this URL is in browser histories and
 * bookmarks, and a 404 on a page that worked yesterday reads as the portal
 * being broken rather than as a screen having moved.
 */
export default function FindAVehicleMoved() {
  const router = useRouter();
  useEffect(() => { router.replace('/valet/visits'); }, [router]);

  return (
    <div className="p-8">
      <p className="text-sm text-gray-500">
        Find a vehicle is now the search box on the Vehicle log. Taking you there…
      </p>
    </div>
  );
}
