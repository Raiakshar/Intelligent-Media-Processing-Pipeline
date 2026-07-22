/* ============================================================
   API Client — Talks to the media-pipeline Express backend
   ============================================================ */

const API_BASE =
  import.meta.env.VITE_API_BASE_URL ||
  "http://localhost:3000";

/**
 * Upload a single image file.
 * Returns { id, status, uploadedAt, message }.
 */
export async function uploadImage(file) {
  const form = new FormData();
  form.append('image', file);

  const res = await fetch(`${API_BASE}/images`, {
    method: 'POST',
    body: form,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || 'Upload failed');
  }

  return res.json();
}

/**
 * List images with optional status filter + pagination.
 * Returns { items, total, limit, offset }.
 */
export async function listImages({ status, limit = 20, offset = 0 } = {}) {
  const params = new URLSearchParams();
  if (status) params.set('status', status);
  params.set('limit', String(limit));
  params.set('offset', String(offset));

  const res = await fetch(`${API_BASE}/images?${params}`);
  if (!res.ok) throw new Error('Failed to fetch images');
  return res.json();
}

/**
 * Get processing status for a single image.
 */
export async function getImageStatus(id) {
  const res = await fetch(`${API_BASE}/images/${id}/status`);
  if (!res.ok) throw new Error('Failed to fetch status');
  return res.json();
}

/**
 * Get full analysis results (409 if not yet completed).
 */
export async function getImageResults(id) {
  const res = await fetch(`${API_BASE}/images/${id}/results`);
  if (res.status === 409) {
    const data = await res.json();
    return { notReady: true, ...data };
  }
  if (!res.ok) throw new Error('Failed to fetch results');
  return res.json();
}

/**
 * Get failure reason (409 if not failed).
 */
export async function getImageFailure(id) {
  const res = await fetch(`${API_BASE}/images/${id}/failure`);
  if (res.status === 409) return null;
  if (!res.ok) throw new Error('Failed to fetch failure');
  return res.json();
}

/**
 * Simple health check.
 */
export async function healthCheck() {
  try {
    const res = await fetch(`${API_BASE}/health`);
    return res.ok;
  } catch {
    return false;
  }
}
