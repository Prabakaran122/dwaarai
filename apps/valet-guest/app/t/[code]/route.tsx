import { ImageResponse } from 'next/og';
import { resolveValetBase } from '@/lib/api';

/**
 * The guest's status as a picture.
 *
 * On authkey.io every message is a pre-approved static template, so the words
 * can never change with the situation -- only a media header can. This is
 * that header: rendered per request, so a message sent at 9:04 shows where
 * the car was at 9:04.
 *
 * Addressed by claim code rather than session token, matching every other
 * guest link: the code stops resolving the moment the stay closes, while a
 * token forwarded to somebody else would keep working.
 */
export const runtime = 'nodejs';
// Rendered on request, never at build. Caching downstream is bounded by
// CACHE_CONTROL below: a long-cached timeline is a timeline that is wrong.
export const dynamic = 'force-dynamic';

// Server-side, so it may skip the public hop: VALET_INTERNAL_API_URL (e.g.
// http://127.0.0.1:3060 on the same box) keeps these renders out of the guest
// API's per-IP rate limit, which would otherwise count every WhatsApp image
// against this server's single address. Falls back to the public URL, and that
// to localhost only outside production (resolveValetBase throws there).
const API = process.env.VALET_INTERNAL_API_URL || resolveValetBase();

/**
 * Short and shared. ImageResponse defaults to a year-long `immutable` cache in
 * production, and this URL is the same for every message of a stay -- so a
 * provider or proxy honouring that would show the check-in picture under the
 * "at the door" message. A few seconds still absorbs a burst of fetches for
 * one message without letting a stage go stale.
 */
const CACHE_CONTROL = 'public, max-age=10, s-maxage=10, must-revalidate';

const STAGES = ['Checked in', 'Requested', 'On the way', 'At the door'] as const;

/** Where each lifecycle status sits on the four-stage journey. */
const STAGE_OF: Record<string, number> = {
  parked: 0,
  parked_again: 0,
  retrieval_requested: 1,
  en_route: 2,
  arrived: 3,
  // Out with a multi-day guest: the last pickup completed the journey.
  with_guest: 3,
};

const INK = '#0F2A38';
const TEAL = '#2FA8A0';
const MUTED = '#7C97A3';

function etaLabel(etaSeconds: number | null, status: string) {
  if (status === 'arrived') return 'Waiting for you now';
  if (status !== 'en_route' || etaSeconds === null) return null;
  const mins = Math.ceil(etaSeconds / 60);
  return mins <= 1 ? 'Arriving any moment' : `About ${mins} minutes away`;
}

export async function GET(
  _req: Request,
  { params }: { params: { code: string } }
) {
  let t: {
    displayId?: string; plate?: string; vehicleMake?: string;
    venueName?: string; status?: string; etaSeconds?: number | null;
  } = {};

  try {
    const claim = await fetch(`${API}/guest/claim/${params.code}`, { cache: 'no-store' });
    if (claim.ok) {
      const { sessionToken } = await claim.json();
      const res = await fetch(`${API}/guest/tickets/${sessionToken}`, { cache: 'no-store' });
      if (res.ok) t = await res.json();
    }
  } catch {
    /* fall through to the empty card below */
  }

  // An unresolvable code still renders, rather than 404ing into a broken
  // image in a chat thread: WhatsApp has already sent the message by then,
  // and a blank grey box is the worst thing a guest could be left looking at.
  const stage = STAGE_OF[t.status ?? ''] ?? 0;
  const eta = etaLabel(t.etaSeconds ?? null, t.status ?? '');
  const vehicle = [t.vehicleMake, t.plate].filter(Boolean).join('  ·  ');
  // Built as one string, not two children: Satori requires an explicit
  // display on any element with more than one child, and two adjacent
  // expressions count as two.
  const subtitle = [vehicle || 'Your vehicle', t.displayId ? `Ticket ${t.displayId}` : '']
    .filter(Boolean).join('   ·   ');

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
          backgroundColor: '#FFFFFF', padding: '56px 64px',
          fontFamily: 'sans-serif', justifyContent: 'space-between',
        }}
      >
        {/* Venue, and whose system this is */}
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ fontSize: 46, fontWeight: 700, color: INK, letterSpacing: -1 }}>
            {t.venueName || 'Valet'}
          </div>
          <div style={{ fontSize: 22, color: MUTED, marginTop: 6 }}>{subtitle}</div>
        </div>

        {/* The journey.
            Each stage is a column holding its own dot and label, with the
            connectors between columns, so a label can never drift away from
            the dot it names however the widths fall out. */}
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start' }}>
            {STAGES.map((label, i) => {
              const done = i <= stage;
              const isNow = i === stage;
              return (
                <div key={label} style={{ display: 'flex', flex: 1, alignItems: 'flex-start' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 150 }}>
                    <div
                      style={{
                        display: 'flex',
                        width: isNow ? 34 : 20, height: isNow ? 34 : 20, borderRadius: 999,
                        backgroundColor: done ? TEAL : '#DCE6EA',
                        // No tick mark: the default font has no checkmark
                        // glyph and renders a tofu box. Colour carries it.
                        border: isNow ? `8px solid ${TEAL}2E` : 'none',
                        marginTop: isNow ? 0 : 7,
                      }}
                    />
                    <div
                      style={{
                        display: 'flex', marginTop: 16, fontSize: 22, textAlign: 'center',
                        fontWeight: isNow ? 700 : 400,
                        color: isNow ? INK : MUTED,
                      }}
                    >
                      {label}
                    </div>
                  </div>
                  {i < STAGES.length - 1 ? (
                    <div style={{ flex: 1, height: 4, borderRadius: 2, marginTop: 15, backgroundColor: i < stage ? TEAL : '#DCE6EA' }} />
                  ) : null}
                </div>
              );
            })}
          </div>

          <div style={{ display: 'flex', justifyContent: 'center', marginTop: 34, fontSize: 30, color: eta ? TEAL : 'transparent', fontWeight: 700 }}>
            {eta || '.'}
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', fontSize: 19, color: MUTED }}>
          Powered by DwaarAI
        </div>
      </div>
    ),
    // Lowercase on purpose: ImageResponse spreads this over its own
    // 'cache-control' key, and a 'Cache-Control' key would be a second header
    // appended to the year-long one rather than a replacement for it.
    { width: 1200, height: 630, headers: { 'cache-control': CACHE_CONTROL } }
  );
}
