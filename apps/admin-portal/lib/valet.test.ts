import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { valetFetch, valetPost, ValetError, STATUS_LABEL, NEEDS_ACTION, ValetStatus, formatStay,
  previewRange, listCards, registerCards, setCardActive, searchPlates } from './valet';

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
    'parked', 'requested', 'en_route', 'arrived',
    'parked_again', 'final_closed', 'expired',
  ];

  it('labels every state the service can return, so none renders as raw jargon', () => {
    for (const status of ALL) {
      expect(STATUS_LABEL[status]).toBeTruthy();
      expect(STATUS_LABEL[status]).not.toBe(status);
    }
  });

  it('treats exactly the two waiting-on-a-valet states as needing action', () => {
    expect(NEEDS_ACTION).toEqual(['requested', 'arrived']);
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
      mockResponse(409, { error: 'card_in_use', message: 'Card is on ticket SRT-0009.' })
    );

    await expect(setCardActive('c1', false)).rejects.toMatchObject({
      code: 'card_in_use',
      message: 'Card is on ticket SRT-0009.',
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
