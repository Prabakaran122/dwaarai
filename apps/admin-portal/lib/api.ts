const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000/api/v1';

function getToken(): string {
  if (typeof window === 'undefined') return '';
  return localStorage.getItem('cg_admin_token') || '';
}

function getCommunityId(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('cg_selected_community_id');
}

/** Where a signed-out user belongs. basePath is '/admin'. */
const LOGIN_PATH = '/admin/login';

export async function apiFetch<T = unknown>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const communityId = getCommunityId();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(communityId ? { 'X-Community-Id': communityId } : {}),
    ...(options.headers as Record<string, string> || {}),
  };
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
    cache: 'no-store',
  });
  if (res.status === 401) {
    if (typeof window !== 'undefined') {
      localStorage.removeItem('cg_admin_token');
      localStorage.removeItem('cg_admin_user');
      // Assigning href to the page you are already on is a full reload, and
      // anything that fetches on mount turns that into an endless refresh.
      // That is exactly what the portal did on its own login screen: a
      // request fired there, 401'd because there is no session on a login
      // page, and reloaded into the same request.
      if (window.location.pathname !== LOGIN_PATH) {
        window.location.href = LOGIN_PATH;
      }
    }
    throw new Error('Unauthorized');
  }
  if (!res.ok) {
    // The server's own message, when it sent one. A refusal like "still has 25
    // residents, 13 units" is composed precisely so somebody does not have to
    // go hunting for what is in the way, and throwing away the body to report
    // "API error: 409 Conflict" discarded exactly that. Falls back to the
    // status when the body is missing, unparseable, or carries no message.
    let message = `API error: ${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      if (body?.error?.message) message = body.error.message;
      else if (typeof body?.message === 'string') message = body.message;
    } catch {
      /* non-JSON error body; the status line is all there is */
    }
    throw new Error(message);
  }
  return res.json();
}

export async function apiPost<T = unknown>(path: string, body: unknown): Promise<T> {
  return apiFetch<T>(path, { method: 'POST', body: JSON.stringify(body) });
}

export async function apiPut<T = unknown>(path: string, body: unknown): Promise<T> {
  return apiFetch<T>(path, { method: 'PUT', body: JSON.stringify(body) });
}

export async function apiDelete<T = unknown>(path: string): Promise<T> {
  return apiFetch<T>(path, { method: 'DELETE' });
}
