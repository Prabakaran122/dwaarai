# DwaarAI Valet on WhatsApp — design

**Status:** proposed, not built
**Date:** 2026-09-11

## The goal

Replace handing a guest a printed card. At intake the guest scans a QR from
the guard's screen and walks away with their ticket live in WhatsApp: the
vehicle, who has it, status as it changes, and a way to ask for the car back.

## Why this is worth doing

The claim code exists because a guest who walked away had no route back to
their own car. It solved that, but it still asks a guest to remember six
characters, and the venue to manage a box of plastic that gets lost, pocketed
and not returned.

WhatsApp removes both. The ticket lands in a thread the guest already has open
fifty times a day, it is findable weeks later, and — the part no web page can
do — **it can notify them**. "Your car is at the porch" arriving as a
notification is a materially better product than a page they have to keep
open.

## The insight that makes it affordable

WhatsApp Business messaging is normally gated behind template approval, which
is slow and, for anything marketing-flavoured, uncertain.

**A guest who scans a QR and sends us a message removes that gate.** A
user-initiated message opens a 24-hour customer service window in which we may
send free-form messages with no template at all. It is also, simultaneously:

- Meta's opt-in requirement, satisfied by the guest's own action
- a DPDP consent far cleaner than a guard typing a number on a guest's behalf
- a verified phone number, delivered by webhook, with no typing and no typos

The `phone_number` and `phone_consent_at` columns added in migration 047 are
exactly where this lands.

## The QR points at us, not at WhatsApp

The obvious design encodes `wa.me/<number>?text=...` directly in the QR. We
should not do that.

A guest without WhatsApp — or one who simply does not want to message a
business — scans it and lands on a "download WhatsApp" page, having been given
nothing. That is a worse outcome than the card they did not get.

Instead the QR encodes a page we own, reusing the existing card-landing shape:

    /valet/w/<claimCode>

That page offers two doors:

- **Continue on WhatsApp** — a `wa.me` deep link with the message prefilled
- **Continue in the browser** — straight to the ticket page, exactly as today

One QR, both kinds of guest, and we keep control of the moment. It also means
the venue does not need to decide in advance which guests have WhatsApp.

## The rotating pickup QR cannot live in WhatsApp

Worth stating because it constrains the whole design.

The pickup QR rotates every 18 seconds and only the most recently issued token
validates, specifically so a screenshot cannot be replayed. A QR image sent
over WhatsApp is dead before the guest reads it.

So WhatsApp carries **the link**; the web page keeps **the QR**. WhatsApp
complements the ticket page, it does not replace it. Every message that needs
the guest to do something ends in a link back.

## Flow

1. Guard creates the ticket as today. The screen shows one QR — the
   `/valet/w/<code>` page — with the claim code printed underneath as it is now.
2. Guest scans with their ordinary camera, taps **Continue on WhatsApp**,
   sends the prefilled message.
3. Webhook arrives. We resolve the claim code, bind the number to the ticket,
   stamp consent, and reply with the vehicle, the guard's name and the link.
4. Status changes push to the thread: accepted, on its way with an ETA,
   arrived.
5. Guest replies asking for the car. We request it and confirm.
6. On checkout, the thank-you message, and the number is forgotten on the
   existing sweep.

## Binding an inbound message to a ticket

The prefilled text carries the **claim code**, which is already globally unique
among open tickets and already resolvable (`GET /guest/claim/:code`).

The prefill is editable before sending, so parsing must be defensive. This is
cheaper than it sounds: the claim-code alphabet deliberately excludes O, I, S,
0, 1 and 5, so a six-character run from the remaining thirty is a specific
pattern that ordinary words do not match, and `normalizeClaimCode()` already
folds the confusable characters a guest might retype.

If no code can be found, reply asking for it rather than failing silently.

**The session token must never appear in the message.** It is the credential;
a code that stops resolving when the ticket closes is not.

## The 24-hour window

Every inbound message opens or extends a 24-hour window. Inside it, free-form.
Outside it, an approved template.

For same-day valet — the overwhelming majority — the guest's own messages keep
the window open and no template is ever needed. A multi-day stay will fall
outside it: dropped Monday evening, collected Wednesday, silent in between.

So **one utility template** is required, to re-engage a quiet thread. Utility
is a far easier approval than marketing and is the correct category for "your
car is ready". Everything else can be free-form.

This forces one architectural rule: **all outbound goes through a single
function** that checks `whatsapp_last_inbound_at` and chooses free-form or
template. No route composes a WhatsApp message itself.

## Inbound commands

Deliberately small. One intent matters:

- **Request** — anything meaning "bring my car". Replies depend on status, not
  on what was asked: `parked`/`parked_again` requests it; `requested` says it
  is already in hand; `en_route` gives the ETA; `arrived` sends the link so the
  guest can show the live QR; closed says so.
- **Anything else** — reply with the ticket link and one line of help. No
  attempt at conversation.

An unrecognised message must never be silently dropped. A guest who typed
something and got nothing back assumes the whole channel is broken.

## Second scanner

The first inbound binds. A later message from a different number gets the
ticket link but does not rebind — a valet stand is a public place and a ticket
should not migrate to whoever scanned last.

## Provider

MSG91 resells the WhatsApp Business API on the account api-gateway already
uses, so no new vendor and no new billing relationship. Meta's Cloud API is
cheaper at volume.

Both sit behind `services/valet-service/src/lib/whatsapp.js`, the way
`storage.js` hides S3 versus local disk. Nothing above that file knows which
provider is live, and an unconfigured deployment reports `skipped` rather than
claiming success — the same rule `sms.js` follows.

## Webhook

`POST /webhooks/whatsapp` on valet-service, public by necessity, with:

- **Signature verification.** `razorpay.js:107` is the pattern — HMAC-SHA256
  over the raw body, compared with `timingSafeEqual`.
- **Idempotency.** Providers retry. A `valet_whatsapp_messages` row keyed on
  the provider's message id, written before processing, makes a redelivery a
  no-op. Requesting a guest's car twice because Meta retried is exactly the
  failure this prevents.
- **A fast 200.** Acknowledge, then work. A slow handler gets retried, which
  is how duplicates start.

## Schema — migration 048

    ALTER TABLE valet_tickets
      ADD COLUMN whatsapp_last_inbound_at TIMESTAMPTZ;

    CREATE TABLE valet_whatsapp_messages (
      id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      provider_message_id VARCHAR(128) NOT NULL UNIQUE,
      ticket_id           UUID REFERENCES valet_tickets(id),
      direction           VARCHAR(8) NOT NULL,
      received_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

`phone_number` and `phone_consent_at` are reused from 047. The existing
`forgetClosedGuestPhones()` sweep already clears them on close and needs no
change.

## What this does not do

- **It is not faster than the screen QR.** That opens the ticket instantly;
  this needs a send and a reply. WhatsApp beats the *card* on durability and
  notification. It does not beat the QR on speed.
- **It does not remove cards.** A venue with card stock and a guest without
  WhatsApp both still work. This is a fourth way in, not a replacement.
- **It does not ship without Meta.** Business verification and a dedicated
  number are required, take days to weeks, and no amount of code shortens them.
  Everything below the provider boundary can be built and tested before that
  finishes.

## Open questions

1. **Whose number?** One DwaarAI number serving every venue (one verification,
   message reads "The Leela, via DwaarAI Valet") or a number per hotel (better
   branding, a verification blocker on every onboarding). Recommend ours.
2. **Language.** The app speaks English, Hindi and Kannada. Templates are
   approved per language, so multi-language re-engagement multiplies the
   approvals. Recommend English first.
