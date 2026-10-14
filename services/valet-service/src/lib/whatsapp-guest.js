import { sendText, sendTemplate, supportsFreeForm } from './whatsapp.js';

/**
 * Everything the guest is ever told, and the one decision about how to tell
 * them.
 *
 * WhatsApp permits free-form replies only within 24 hours of a message the
 * guest sent us. Outside that, only an approved template is delivered -- and a
 * free-form send outside the window is *accepted by the API and dropped*,
 * which is the worst available failure: a guest on a multi-day stay silently
 * never hears that their car is ready. So the window is checked once, here,
 * and no route composes a message of its own.
 */

export const WINDOW_MS = 24 * 60 * 60 * 1000;

const baseUrl = () => process.env.VALET_GUEST_BASE_URL || 'https://dwaarai.com/valet';

/**
 * The claim code, never the session token. The code stops resolving the
 * moment the ticket closes; the token would keep working for anyone the
 * message was forwarded to.
 *
 * `/track/`, not `/w/`. The latter is the door the intake QR opens, where a
 * guest who has not picked a channel is offered WhatsApp or the browser --
 * which is the wrong question to ask somebody who is reading this link
 * *inside WhatsApp*, having just replied CAR. `/track/` resolves the same
 * code and goes straight to the live timeline.
 */
const trackUrl = (t) => `${baseUrl()}/track/${t.claim_code}`;

/**
 * The status card a media template carries as its header.
 *
 * Rendered per request, so a message sent at 9:04 shows where the car was at
 * 9:04 -- which is the only reason a picture beats the words, given the words
 * are fixed by whatever Meta approved. Claim code, not session token, like
 * every other guest link.
 */
const timelineUrl = (t) => `${baseUrl()}/t/${t.claim_code}`;

/**
 * Whether the approved templates carry an image header.
 *
 * Off by default and deliberately explicit: declaring media against a
 * template Meta approved as text makes the provider reject every send, which
 * is worse than a plain message. It flips only once the media templates are
 * approved and their ids are configured.
 */
const mediaTemplates = () => process.env.WHATSAPP_TEMPLATE_MEDIA === '1';

function compose(t, kind) {
  switch (kind) {
    case 'bound':
      return `${t.community_name}: your car is with us.\n`
        + `${t.plate} · ${t.vehicle_make}\nTicket ${t.display_id}\n\n`
        + `Reply CAR when you want it brought round, or track it here: ${trackUrl(t)}`;

    case 'with_guest':
      return `${t.community_name}: your car (${t.plate}) is with you.\n`
        + 'When you bring it back, hand the keys and your valet card to the valet desk.';

    case 'accepted':
      return `${t.community_name}: a valet is getting your car (${t.plate}).\n`
        + `Track it: ${trackUrl(t)}`;

    case 'en_route':
      return 'Your car is on its way'
        + (t.eta_minutes ? ` — about ${t.eta_minutes} minutes.` : '.')
        + (t.current_guard_name ? `\n${t.current_guard_name} is bringing it.` : '')
        + `\n\n${trackUrl(t)}`;

    case 'arrived':
      // The pickup QR rotates every 18 seconds and only the newest one
      // validates, so it cannot be sent as an image -- it would be stale
      // before the guest read it. The link is the delivery mechanism.
      return 'Your car is at the pickup point.\n'
        + `Open this to show the valet your code: ${trackUrl(t)}`;

    case 'closed':
      return `Thank you for visiting ${t.community_name}.\nTicket ${t.display_id}`;

    default:
      return `${t.community_name}: ${trackUrl(t)}`;
  }
}

function withinWindow(t) {
  if (!t.whatsapp_last_inbound_at) return false;
  return Date.now() - new Date(t.whatsapp_last_inbound_at).getTime() < WINDOW_MS;
}

/**
 * For a guest who scanned the card before the guard finished intake.
 *
 * There is no ticket to describe yet, so this says only that we have them --
 * and the welcome with the vehicle in it follows the moment intake completes.
 * Silence here would read as a card that does not work.
 */
export function notifyCardHeld(waId, venueName) {
  return sendText(
    waId,
    `${venueName || 'The valet desk'}: got it — we're checking your car in now.\n`
    + `We'll message you here the moment it's parked.`
  );
}

/**
 * One approved template per thing worth saying.
 *
 * A provider that cannot send free text can only say what has been approved
 * in advance, so the set of templates *is* the set of things this product can
 * tell a guest. With only car_ready configured, every notification said
 * "ready for collection" -- including the one sent the moment a car was
 * parked, which is how a guest was told to come and collect a car that had
 * just been handed over.
 */
const TEMPLATE_FOR = {
  // The car is with us.
  bound: () => process.env.WHATSAPP_TEMPLATE_CHECKED_IN,
  // We have the request; a valet is walking to the car.
  accepted: () => process.env.WHATSAPP_TEMPLATE_REQUESTED
    || process.env.WHATSAPP_TEMPLATE_ON_THE_WAY,
  // The car is moving.
  en_route: () => process.env.WHATSAPP_TEMPLATE_ON_THE_WAY,
  // It is at the kerb.
  arrived: () => process.env.WHATSAPP_TEMPLATE_CAR_READY || 'car_ready',
};

/** What each template's {{1}}, {{2}}, {{3}} are filled with. */
function templateVars(t, kind) {
  const venue = t.community_name || 'Your venue';
  if (kind === 'bound') {
    const car = [t.vehicle_make, t.plate].filter(Boolean).join(' - ');
    // The link rides along with the ticket number.
    //
    // The approved body is "{{1}}.\n\n{{2}}\nTicket {{3}}\n\nReply CAR
    // here ..." -- three variables, all spoken for, and no slot for a URL. So
    // the one message every guest is guaranteed to receive first was the only
    // one they could not reach the timeline from, while accepted / en_route /
    // arrived all send it as {{3}}.
    //
    // Same line, middot separated: a template parameter may not contain a
    // newline and Meta rejects the send outright if it does.
    //
    // The proper fix is a fourth variable on the template and a re-approval,
    // at which point this collapses back to `t.display_id` and the URL moves
    // to its own slot.
    const ticketCell = t.claim_code
      ? `${t.display_id || ''} · ${trackUrl(t)}`.trim()
      : (t.display_id || '');
    return [venue, car || 'Your vehicle', ticketCell];
  }
  return [venue, t.display_id || '', trackUrl(t)];
}


/**
 * Which stages are worth a billed message.
 *
 * Every send costs, and three of the five stages only restate what the
 * tracking link already shows live: "on its way" tells a guest who just asked
 * that their request landed, and "thank you" arrives after they have driven
 * away carrying nothing at all. Those are off.
 *
 * `arrived` is off too, by instruction, and it is the one to reconsider
 * first: a guest waiting in a lobby is not watching the page, and that
 * message is what sends them outside. Turning it back on is
 *
 *     WHATSAPP_NOTIFY_STAGES=bound,accepted,arrived
 *
 * -- an env change, not a release, because the cost of being wrong here is a
 * car blocking the porch while its owner reads a magazine.
 *
 * The list is absolute, not additive: what it names is exactly what sends.
 */
const NOTIFY_DEFAULT = ['bound', 'accepted'];

function enabledStages() {
  const raw = process.env.WHATSAPP_NOTIFY_STAGES;
  // Unset *or blank*. A variable that exists but is empty is a deploy
  // accident far more often than a deliberate vow of silence, and reading it
  // as "send nothing" would take every guest notification down with no error
  // raised anywhere.
  if (!raw || !raw.trim()) return NOTIFY_DEFAULT;
  if (raw.trim().toLowerCase() === 'none') return [];
  return raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
}

export async function notifyGuest(ticket, kind) {
  // Checked first, and reported with its own reason: an operator looking at a
  // quiet thread needs to tell "this stage is muted" from "we never had a
  // number for this guest".
  if (!enabledStages().includes(kind)) return { status: 'skipped', reason: 'stage_muted' };
  if (!ticket?.phone_number) return { status: 'skipped', reason: 'no_phone_number' };

  // Asked up front rather than discovered by a failed send, because it
  // changes what may be said and not merely how.
  if (!supportsFreeForm()) {
    const wid = TEMPLATE_FOR[kind]?.();
    // Silence beats a wrong message. Telling a guest their car is ready when
    // it is still being fetched sends them to the kerb for a car that is not
    // there, and the tracking link they already hold is live either way.
    if (!wid) return { status: 'skipped', reason: 'no_template_for_kind' };
    const opts = mediaTemplates() && ticket.claim_code
      ? { headerImageUrl: timelineUrl(ticket), headerFileName: 'status.png' }
      : {};
    return sendTemplate(ticket.phone_number, wid, templateVars(ticket, kind), opts);
  }

  if (withinWindow(ticket)) {
    const free = await sendText(ticket.phone_number, compose(ticket, kind));
    if (free.status !== 'failed') return free;
    // Falls through to the template. authkey.io publishes no free-form path,
    // so a rejection here may mean the provider simply cannot do it -- and a
    // guest who never hears their car is at the door is a worse outcome than
    // one who hears it in slightly stiffer wording. 'skipped' is deliberately
    // not a fallback: nothing is configured, so the retry would only be a
    // second skip that reads like a real attempt.
  }

  // One template covers every re-engagement. Utility category: "your car is
  // ready" is a service message, which is both cheaper and far easier to get
  // approved than anything marketing-shaped.
  const name = process.env.WHATSAPP_TEMPLATE_CAR_READY || 'car_ready';
  return sendTemplate(ticket.phone_number, name, [
    ticket.community_name || 'Your venue',
    ticket.display_id || '',
    trackUrl(ticket),
  ]);
}
