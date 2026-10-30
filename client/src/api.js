export async function api(path, options = {}) {
  let response;
  try {
    response = await fetch('/api' + path, {
      credentials: 'include',
      headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers },
      ...options,
    });
  } catch {
    throw new Error('Can’t reach the Northstar API. Start the backend and connect MongoDB; see the README setup steps.');
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error || 'Something went wrong.');
    error.status = response.status;
    throw error;
  }
  return payload;
}

export const post = (path, body) => api(path, { method: 'POST', body: JSON.stringify(body) });
export const patch = (path, body) => api(path, { method: 'PATCH', body: JSON.stringify(body) });
export const del = (path) => api(path, { method: 'DELETE' });

export function formatDate(value, options = { weekday: 'short', month: 'short', day: 'numeric' }) {
  return new Date(value).toLocaleDateString(undefined, options);
}
export function formatTime(value) {
  return new Date(value).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}
export function formatMoney(value, currency = 'USD') {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 0 }).format(value || 0);
}
