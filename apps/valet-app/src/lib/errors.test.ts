import { isStatusChanged, communityOfToken } from './errors';

function jwt(payload: object) {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${b64({ alg: 'HS256' })}.${b64(payload)}.sig`;
}

describe('isStatusChanged', () => {
  it('is only a 409 carrying status_changed', () => {
    expect(isStatusChanged({ response: { status: 409, data: { error: 'status_changed' } } })).toBe(true);
    expect(isStatusChanged({ response: { status: 409, data: { error: 'card_in_use' } } })).toBe(false);
    expect(isStatusChanged({ message: 'Network Error' })).toBe(false);
  });
});

describe('communityOfToken', () => {
  it('reads the venue claim', () => {
    expect(communityOfToken(jwt({ community_id: 'c-1', sub: 'g1' }))).toBe('c-1');
  });

  it('answers null for anything it cannot read', () => {
    expect(communityOfToken('not-a-jwt')).toBeNull();
    expect(communityOfToken(jwt({ sub: 'g1' }))).toBeNull();
  });
});
