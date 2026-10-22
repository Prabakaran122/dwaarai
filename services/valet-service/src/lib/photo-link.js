import jwt from 'jsonwebtoken';
import { JWT_SECRET } from '../middleware/auth.js';

/**
 * Short-lived links to a ticket's guest photo, for the handover screen.
 *
 * The app used to load GET /guard/tickets/:token/photo with an Authorization
 * header on the <Image> source. React Native's native image loader dropped
 * that header, so the request arrived anonymous, 401'd, and the guard was
 * asked to confirm "Person matches" against an empty frame -- and the release
 * was recorded as a photo match. A signed URL needs no header at all.
 *
 * The link names one ticket in one community, has its own purpose claim so a
 * guard's login JWT cannot be replayed as one, and expires in two minutes:
 * long enough to load, too short to be worth forwarding.
 */
export const PHOTO_LINK_TTL_SECONDS = 120;
const PURPOSE = 'guest_photo';

export function signPhotoLink(ticketId, communityId) {
  return jwt.sign({ purpose: PURPOSE, tid: ticketId, cid: communityId }, JWT_SECRET, {
    expiresIn: PHOTO_LINK_TTL_SECONDS,
  });
}

/** Returns { ticketId, communityId }, or null for anything not a live link. */
export function verifyPhotoLink(sig) {
  try {
    const p = jwt.verify(sig, JWT_SECRET);
    if (p.purpose !== PURPOSE || !p.tid || !p.cid) return null;
    return { ticketId: p.tid, communityId: p.cid };
  } catch {
    return null;
  }
}

/**
 * The same idea for the admin portal's condition media.
 *
 * The portal's ticket page put the auth-required media route straight into
 * <img src>, which sends no Authorization header, so every condition tile was
 * a broken image. A separate purpose from the guest photo, so neither kind of
 * link can be replayed as the other, and scoped to one media record (not a
 * ticket) in one community: a link to a car's front view opens that view and
 * nothing else.
 */
export const MEDIA_LINK_TTL_SECONDS = 120;
const MEDIA_PURPOSE = 'admin_media';

export function signMediaLink(mediaId, communityId) {
  return jwt.sign({ purpose: MEDIA_PURPOSE, mid: mediaId, cid: communityId }, JWT_SECRET, {
    expiresIn: MEDIA_LINK_TTL_SECONDS,
  });
}

/** Returns { mediaId, communityId }, or null for anything not a live link. */
export function verifyMediaLink(sig) {
  try {
    const p = jwt.verify(sig, JWT_SECRET);
    if (p.purpose !== MEDIA_PURPOSE || !p.mid || !p.cid) return null;
    return { mediaId: p.mid, communityId: p.cid };
  } catch {
    return null;
  }
}

// Video too: condition media may be a clip (storage.extensionFor writes webm
// or mp4), and a video served as octet-stream will not play in a <video>.
const TYPES = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', heic: 'image/heic',
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
};

/** The response type for a stored photo, from its key's extension. */
export function contentTypeFor(key) {
  return TYPES[String(key).split('.').pop().toLowerCase()] || 'application/octet-stream';
}
