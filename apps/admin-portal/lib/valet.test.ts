import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { finishedVisits, valetFetch, valetPost, ValetError, STATUS_LABEL, NEEDS_ACTION, ValetStatus, formatStay,
  previewRange, listCards, registerCards, setCardActive, searchPlates,
  groupSlots, dayRangeToInstants, rupees, resolveValetBase, valetErrorMessage, PICK_PROPERTY_MESSAGE,
  ticketStatusLabel, visitStatusCell } from './valet';

const originalFetch = global.fetch;

function mockResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: 'Test',
    json: async () => body,
  } as Response;
}

beforeEach(() => {
  localStorage.clear();
  global.fetch = vi.fn();
});

afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('valetFetch', () => {
  it('sends the admin token from the same place lib/api.ts reads it', async () => {
    localStorage.setItem('cg_admin_token', 'jwt-123');
    vi.mocked(global.fetch).mockResolvedValue(mockResponse(200, { ok: true }));

    await valetFetch('/guard/tickets');

    const headers = vi.mocked(global.fetch).mock.calls[0][1]?.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer jwt-123');
  });

  it('forwards the selected community so a super admin can inspect one', async () => {
    localStorage.setItem('cg_admin_token', 'jwt-123');
    localStorage.setItem('cg_selected_community_id', 'community-9');
    vi.mocked(global.fetch).mockResolvedValue(mockResponse(200, {}));

    await valetFetch('/guard/tickets');

    const headers = vi.mocked(global.fetch).mock.calls[0][1]?.headers as Record<string, string>;
    expect(headers['X-Community-Id']).toBe('community-9');
  });

  it('omits the auth header entirely when there is no token', async () => {
    vi.mocked(global.fetch).mockResolvedValue(mockResponse(200, {}));

    await valetFetch('/guard/tickets');

    const headers = vi.mocked(global.fetch).mock.calls[0][1]?.headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
  });

  it('never serves a cached queue: a stale valet list is worse than none', async () => {
    vi.mocked(global.fetch).mockResolvedValue(mockResponse(200, {}));

    await valetFetch('/guard/tickets');

    expect(vi.mocked(global.fetch).mock.calls[0][1]?.cache).toBe('no-store');
  });

  it('preserves the service error code so the UI can explain a 409', async () => {
    vi.mocked(global.fetch).mockResolvedValue(
      mockResponse(409, { error: 'return_condition_required', message: 'Capture a return photo' })
    );

    await expect(valetFetch('/guard/tickets/x/confirm-pickup')).rejects.toMatchObject({
      code: 'return_condition_required',
      status: 409,
      message: 'Capture a return photo',
    });
  });

  it('still throws a usable error when the body is not JSON', async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: false,
      status: 502,
      statusText: 'Bad Gateway',
      json: async () => { throw new Error('not json'); },
    } as unknown as Response);

    await expect(valetFetch('/guard/tickets')).rejects.toBeInstanceOf(ValetError);
  });

  it('clears the token on a 401 rather than leaving a dead session in place', async () => {
    localStorage.setItem('cg_admin_token', 'expired-jwt');
    vi.mocked(global.fetch).mockResolvedValue(mockResponse(401, { error: 'unauthorized' }));

    await expect(valetFetch('/guard/tickets')).rejects.toThrow();
    expect(localStorage.getItem('cg_admin_token')).toBeNull();
  });

  it('returns the parsed body on success', async () => {
    vi.mocked(global.fetch).mockResolvedValue(mockResponse(200, { tickets: [{ id: 'a' }] }));

    const res = await valetFetch<{ tickets: { id: string }[] }>('/guard/tickets');

    expect(res.tickets[0].id).toBe('a');
  });
});

describe('valetPost', () => {
  it('sends an empty object rather than no body, since the routes read req.body', async () => {
    vi.mocked(global.fetch).mockResolvedValue(mockResponse(200, {}));

    await valetPost('/guard/tickets/x/arrived');

    expect(vi.mocked(global.fetch).mock.calls[0][1]?.body).toBe('{}');
  });

  it('serialises the body it is given', async () => {
    vi.mocked(global.fetch).mockResolvedValue(mockResponse(200, {}));

    await valetPost('/guard/tickets/x/accept', { etaMinutes: 5 });

    expect(vi.mocked(global.fetch).mock.calls[0][1]?.body).toBe('{"etaMinutes":5}');
  });
});

describe('status vocabulary', () => {
  const ALL: ValetStatus[] = [
    'parked', 'retrieval_requested', 'en_route', 'arrived',
    'parked_again', 'with_guest', 'final_closed', 'expired',
  ];

  it('labels every state the service can return, so none renders as raw jargon', () => {
    for (const status of ALL) {
      expect(STATUS_LABEL[status]).toBeTruthy();
      expect(STATUS_LABEL[status]).not.toBe(status);
    }
  });

  it('treats exactly the two waiting-on-a-valet states as needing action', () => {
    expect(NEEDS_ACTION).toEqual(['retrieval_requested', 'arrived']);
  });

  it('does not flag en_route as needing action: a valet already has the car', () => {
    expect(NEEDS_ACTION).not.toContain('en_route');
  });
});

describe('formatStay', () => {
  it('reads as a manager would say it', () => {
    expect(formatStay(3600)).toBe('1h');
    expect(formatStay(12000)).toBe('3h 20m');
    expect(formatStay(1800)).toBe('30m');
  });

  it('shows a dash rather than "0m" for a stay that has not started', () => {
    expect(formatStay(0)).toBe('—');
    expect(formatStay(-5)).toBe('—');
  });

  it('survives a non-numeric value from the wire', () => {
    expect(formatStay(NaN)).toBe('—');
  });

  it('drops the minutes when they round to zero', () => {
    expect(formatStay(7200)).toBe('2h');
  });
});


describe('previewRange', () => {
  it('pads to the width printed on the card', () => {
    expect(previewRange('A', 1, 3)).toEqual(['A001', 'A002', 'A003']);
  });

  it('uppercases the prefix so a1 and A1 are the same box', () => {
    expect(previewRange('a', 7, 7)).toEqual(['A007']);
  });

  it('honours a non-default width', () => {
    expect(previewRange('V', 9, 10, 2)).toEqual(['V09', 'V10']);
  });

  it('refuses a reversed range rather than silently returning nothing useful', () => {
    expect(previewRange('A', 50, 1)).toEqual([]);
  });

  it('refuses fractional and zero starts', () => {
    expect(previewRange('A', 1.5, 3)).toEqual([]);
    expect(previewRange('A', 0, 3)).toEqual([]);
  });

  it('caps the preview so a mistyped range cannot hang the page', () => {
    // The service refuses more than 500 outright; the preview must not try to
    // build a million strings before the operator sees the error.
    expect(previewRange('A', 1, 100000)).toHaveLength(500);
  });
});

describe('card stock client', () => {
  it('lists cards from the admin scope', async () => {
    vi.mocked(global.fetch).mockResolvedValue(mockResponse(200, { cards: [] }));

    await listCards();

    expect(vi.mocked(global.fetch).mock.calls[0][0]).toContain('/admin/cards');
  });

  it('posts a range as a range, not as an expanded list', async () => {
    // The service builds the codes. Sending 500 strings the server would
    // rebuild anyway is the kind of duplication that lets the two disagree.
    vi.mocked(global.fetch).mockResolvedValue(mockResponse(201, { added: [], skipped: [], total: 0 }));

    await registerCards({ prefix: 'A', from: 1, to: 50 });

    const init = vi.mocked(global.fetch).mock.calls[0][1] as RequestInit;
    expect(JSON.parse(init.body as string)).toEqual({ prefix: 'A', from: 1, to: 50 });
  });

  it('retires and restores through distinct endpoints', async () => {
    vi.mocked(global.fetch).mockResolvedValue(mockResponse(200, { id: 'c1', isActive: false }));

    await setCardActive('c1', false);
    expect(vi.mocked(global.fetch).mock.calls[0][0]).toContain('/admin/cards/c1/deactivate');

    await setCardActive('c1', true);
    expect(vi.mocked(global.fetch).mock.calls[1][0]).toContain('/admin/cards/c1/activate');
  });

  it('surfaces the service\'s reason a card cannot be retired', async () => {
    vi.mocked(global.fetch).mockResolvedValue(
      mockResponse(409, { error: 'card_in_use', message: 'Card is on ticket DWR-0009.' })
    );

    await expect(setCardActive('c1', false)).rejects.toMatchObject({
      code: 'card_in_use',
      message: 'Card is on ticket DWR-0009.',
    });
  });
});

describe('plate search client', () => {
  it('encodes a plate with spaces rather than breaking the query string', async () => {
    vi.mocked(global.fetch).mockResolvedValue(mockResponse(200, { query: '', tickets: [] }));

    await searchPlates('KA 03 NJ');

    expect(vi.mocked(global.fetch).mock.calls[0][0]).toContain('plate=KA%2003%20NJ');
  });
});

describe('groupSlots', () => {
  const slot = (floor: string, zone: string, number: string) =>
    ({ id: `${floor}-${zone}-${number}`, floor, zone, number, occupiedBy: null });

  it('orders basements below ground, deepest first', () => {
    const grouped = groupSlots([
      slot('1', 'A', '01'), slot('B1', 'A', '01'), slot('G', 'A', '01'), slot('B3', 'A', '01'),
    ]);

    // A plain string sort puts B1 above B3 and G after 9 — neither is how a
    // garage is signposted, and the grid is read as a physical building.
    expect(grouped.map((f) => f.floor)).toEqual(['B3', 'B1', 'G', '1']);
  });

  it('nests zones under their floor', () => {
    const grouped = groupSlots([
      slot('B1', 'A', '01'), slot('B1', 'B', '01'), slot('B1', 'A', '02'),
    ]);

    expect(grouped).toHaveLength(1);
    expect(grouped[0].zones.map((z) => z.zone)).toEqual(['A', 'B']);
    expect(grouped[0].zones[0].slots).toHaveLength(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// dayRangeToInstants — the Vehicle log's custom date range
//
// The whole reason this function exists is the timezone. `new Date('2026-08-20')`
// is UTC midnight, which in India is half past five on the morning of the 20th:
// a manager asking for Saturday night would get the wrong end of two different
// days. These tests are written against a fixed offset so they say something
// on any machine that runs them.
// ─────────────────────────────────────────────────────────────────────────────
describe('dayRangeToInstants', () => {
  it('reads the typed dates in the browser’s own zone, not UTC', () => {
    const r = dayRangeToInstants('2026-08-20', '2026-08-22')!;

    // Whatever the runner's zone, the start is local midnight on the 20th and
    // the end is the last millisecond of the 22nd.
    const start = new Date(r.from);
    const end = new Date(r.to);
    expect(start.getFullYear()).toBe(2026);
    expect(start.getMonth()).toBe(7);
    expect(start.getDate()).toBe(20);
    expect(start.getHours()).toBe(0);
    expect(end.getDate()).toBe(22);
    expect(end.getHours()).toBe(23);
    expect(end.getMinutes()).toBe(59);
  });

  // A range of "20th to 22nd" that stopped at the start of the 22nd would drop
  // a whole day, and it is the quiet kind of wrong: nobody notices until they
  // count the rows against the till.
  it('includes the whole of the end day', () => {
    const r = dayRangeToInstants('2026-08-20', '2026-08-20')!;

    expect(new Date(r.to).getTime() - new Date(r.from).getTime())
      .toBe(24 * 60 * 60 * 1000 - 1);
  });

  it('returns null until both dates are filled in', () => {
    expect(dayRangeToInstants('', '2026-08-22')).toBe(null);
    expect(dayRangeToInstants('2026-08-20', '')).toBe(null);
    expect(dayRangeToInstants('not-a-date', '2026-08-22')).toBe(null);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// rupees — money on a rate card
//
// The browser formats paise and does no arithmetic; the server owns every
// total. What this has to get right is how a figure READS, because these end
// up next to each other on an invoice.
// ─────────────────────────────────────────────────────────────────────────────
describe('rupees', () => {
  // "₹1.5" on a rate card reads as a typo, and "₹2,000.00" beside it is noise.
  it('shows paise only when there are any', () => {
    expect(rupees(150)).toBe('₹1.50');
    expect(rupees(200000)).toBe('₹2,000');
    expect(rupees(135000)).toBe('₹1,350');
    expect(rupees(59)).toBe('₹0.59');
  });

  it('groups in the Indian system, because the invoice is in rupees', () => {
    expect(rupees(10000000)).toBe('₹1,00,000');
  });

  // Nothing agreed is not the same as nothing owed, and a zero would read as
  // "free" rather than "no rate set".
  it('says nothing rather than zero when there is no figure', () => {
    expect(rupees(null)).toBe('—');
    expect(rupees(undefined)).toBe('—');
    expect(rupees(0)).toBe('₹0');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The valet-service base URL
//
// A production build with NEXT_PUBLIC_VALET_API_URL unset used to ship a
// localhost fallback, so every valet screen called the operator's own laptop.
// ─────────────────────────────────────────────────────────────────────────────
describe('resolveValetBase', () => {
  it('refuses to fall back to localhost in a production build', () => {
    expect(() => resolveValetBase(undefined, 'production')).toThrow(/NEXT_PUBLIC_VALET_API_URL/);
    expect(() => resolveValetBase('', 'production')).toThrow(/NEXT_PUBLIC_VALET_API_URL/);
  });

  it('keeps the localhost fallback for development and tests', () => {
    expect(resolveValetBase(undefined, 'development')).toBe('http://localhost:3060');
    expect(resolveValetBase(undefined, 'test')).toBe('http://localhost:3060');
  });

  it('uses the configured URL whenever there is one', () => {
    expect(resolveValetBase('https://dwaarai.com/valet-api', 'production')).toBe('https://dwaarai.com/valet-api');
  });
});

describe('no property chosen', () => {
  it('turns no_community into something the operator can act on', async () => {
    vi.mocked(global.fetch).mockResolvedValue(
      mockResponse(403, { error: 'no_community', message: 'Token carries no community' })
    );

    const err = (await valetFetch('/admin/visits').catch((e: unknown) => e)) as ValetError;

    expect(err).toBeInstanceOf(ValetError);
    expect(err.code).toBe('no_community');
    expect(err.message).toBe(PICK_PROPERTY_MESSAGE);
    expect(err.message).not.toMatch(/Token carries/);
  });

  // The vehicle log said "needs an admin account" for every 403, including a
  // super admin who has every permission and had simply not picked a property.
  it('only blames the account when the service said the role was wrong', () => {
    expect(valetErrorMessage(new ValetError(403, 'no_community', 'x'), 'f')).toBe(PICK_PROPERTY_MESSAGE);
    expect(valetErrorMessage(new ValetError(403, 'forbidden', 'Insufficient permissions'), 'f'))
      .toMatch(/admin account/);
    expect(valetErrorMessage(new ValetError(403, 'not_your_property', 'That property is not in this account'), 'f'))
      .toBe('That property is not in this account');
    expect(valetErrorMessage(new Error('boom'), 'fallback')).toBe('fallback');
  });
});

describe('status wording', () => {
  it('names a car out with its guest the way the valet app does', () => {
    expect(STATUS_LABEL.with_guest).toBe('With guest');
  });

  it('does not call a ticket cancelled at intake "Expired"', () => {
    expect(ticketStatusLabel('expired', ['created', 'intake_cancelled'])).toBe('Cancelled at intake');
    expect(ticketStatusLabel('expired', ['intake_started', 'intake_abandoned'])).toBe('Intake not finished');
    expect(ticketStatusLabel('expired', ['created', 'expired'])).toBe('Expired');
    expect(ticketStatusLabel('with_guest')).toBe('With guest');
  });

  it('does not flag a car still with the team as a missing handover', () => {
    expect(visitStatusCell({ status: 'parked', handoverRecorded: false }))
      .toEqual({ label: 'Parked', warn: false });
    expect(visitStatusCell({ status: 'with_guest', handoverRecorded: true }))
      .toEqual({ label: 'With guest', warn: false });
  });

  it('reads an intake closed before parking as that, not as an alarm', () => {
    expect(visitStatusCell({ status: 'expired', handoverRecorded: false, closedReason: 'intake_cancelled' }))
      .toEqual({ label: 'Cancelled at intake', warn: false });
  });

  it('still warns on a closed ticket nobody recorded handing back', () => {
    expect(visitStatusCell({ status: 'expired', handoverRecorded: false }))
      .toEqual({ label: 'Expired, no handover recorded', warn: true });
    expect(visitStatusCell({ status: 'final_closed', handoverRecorded: false }))
      .toEqual({ label: 'No handover recorded', warn: true });
  });
});

describe('which visits a missing handover counts against', () => {
  it('leaves out cars still parked and check-ins that never became a car', () => {
    // The log that read "only 3 of 5 have a handover, the rest were closed
    // by the system": one was parked, one a valet had cancelled.
    expect(finishedVisits({ visits: 5, stillOpen: 1, unfinishedIntakes: 1 })).toBe(3);
  });

  it('treats an older server that sends no count as having none', () => {
    expect(finishedVisits({ visits: 4, stillOpen: 1 })).toBe(3);
  });
});
