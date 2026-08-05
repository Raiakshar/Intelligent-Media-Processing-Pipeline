/* ============================================================
   API Client — Talks to the media-pipeline Express backend
   ============================================================ */

// In production (Render), the frontend is served from the same Express server
// so we use relative URLs (empty string). Locally, set VITE_API_BASE_URL in
// frontend/.env to http://localhost:3000
export const API_BASE = import.meta.env.VITE_API_BASE_URL || "";

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
 * Simple health check — retries up to `retries` times with `delayMs` gap.
 * Handles Render free-tier cold starts gracefully.
 */
export async function healthCheck({ retries = 3, delayMs = 2000 } = {}) {
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(`${API_BASE}/health`);
      if (res.ok) return true;
    } catch { /* network error — keep retrying */ }
    if (i < retries) await new Promise(r => setTimeout(r, delayMs));
  }
  return false;
}
