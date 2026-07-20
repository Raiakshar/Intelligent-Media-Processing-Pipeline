/* ============================================================
   Media Pipeline — Frontend Application
   ============================================================ */

import './style.css';
import {
  uploadImage,
  listImages,
  getImageStatus,
  getImageResults,
  getImageFailure,
  healthCheck,
} from './api.js';

/* ----------------------------------------------------------
   State
   ---------------------------------------------------------- */
const state = {
  images: [],
  total: 0,
  filter: null,      // null = all
  limit: 20,
  offset: 0,
  isOnline: false,
  isLoading: false,
  pollingIds: new Set(),   // image IDs actively polled
};

/* ----------------------------------------------------------
   Utility Helpers
   ---------------------------------------------------------- */
function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function timeAgo(date) {
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function formatCheckName(name) {
  return name
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function getScoreColor(score) {
  if (score >= 0.85) return 'var(--color-success)';
  if (score >= 0.6) return 'var(--color-warning)';
  return 'var(--color-error)';
}

function getCheckIcon(check) {
  const icons = {
    blur_detection: '🔍',
    brightness_analysis: '☀️',
    dimension_validation: '📐',
    duplicate_detection: '👯',
    screenshot_rephoto_heuristic: '📱',
    metadata_analysis: '🏷️',
    tampering_heuristic: '🔧',
    ocr_plate_validation: '🔤',
  };
  return icons[check.check] || '🔎';
}

/* ----------------------------------------------------------
   Toast Notifications
   ---------------------------------------------------------- */
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const icons = { success: '✓', error: '✕', info: 'ℹ' };

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <span class="toast-icon">${icons[type] || 'ℹ'}</span>
    <span class="toast-message">${message}</span>
    <button class="toast-dismiss" onclick="this.parentElement.remove()">✕</button>
  `;

  container.appendChild(toast);
  setTimeout(() => toast.remove(), 5000);
}

/* ----------------------------------------------------------
   Render: Full Page
   ---------------------------------------------------------- */
function renderApp() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <!-- Navbar -->
    <nav class="navbar">
      <div class="container">
        <div class="navbar-brand">
          <div class="navbar-logo">🔬</div>
          <div>
            <span class="navbar-title">Media Pipeline</span>
            <span class="navbar-subtitle">Vehicle Image Analysis</span>
          </div>
        </div>
        <div class="navbar-status">
          <span class="status-dot" id="status-dot"></span>
          <span id="status-text">Checking...</span>
        </div>
      </div>
    </nav>

    <!-- Hero / Upload -->
    <section class="hero-section">
      <div class="container">
        <h1 class="hero-title">
          Intelligent <span class="gradient-text">Image Analysis</span>
        </h1>
        <p class="hero-description">
          Upload vehicle images for automated quality checks — blur detection, brightness analysis,
          duplicate detection, OCR plate validation, tampering heuristics, and more.
        </p>

        <div class="upload-zone" id="upload-zone">
          <div class="upload-zone-content">
            <div class="upload-icon">📤</div>
            <div class="upload-title">Drop image here or click to browse</div>
            <div class="upload-subtitle">Max 15 MB per file</div>
            <div class="upload-formats">
              <span class="format-badge">JPEG</span>
              <span class="format-badge">PNG</span>
              <span class="format-badge">WebP</span>
            </div>
          </div>
          <input type="file" class="upload-input" id="upload-input" accept="image/jpeg,image/png,image/webp" />
        </div>

        <div class="upload-progress" id="upload-progress">
          <div class="progress-bar-container">
            <div class="progress-bar" id="progress-bar"></div>
          </div>
          <div class="progress-text" id="progress-text">Uploading...</div>
        </div>
      </div>
    </section>

    <!-- Dashboard -->
    <section class="images-section">
      <div class="container">
        <!-- Stats -->
        <div class="stats-bar" id="stats-bar">
          <div class="stat-card">
            <div class="stat-value" id="stat-total">—</div>
            <div class="stat-label">Total Images</div>
          </div>
          <div class="stat-card">
            <div class="stat-value" id="stat-completed" style="color: var(--color-success)">—</div>
            <div class="stat-label">Completed</div>
          </div>
          <div class="stat-card">
            <div class="stat-value" id="stat-flagged" style="color: var(--color-warning)">—</div>
            <div class="stat-label">Flagged</div>
          </div>
          <div class="stat-card">
            <div class="stat-value" id="stat-pending" style="color: var(--color-pending)">—</div>
            <div class="stat-label">In Queue</div>
          </div>
        </div>

        <!-- Controls -->
        <div class="controls-bar">
          <div class="filter-group" id="filter-group">
            <button class="filter-btn active" data-filter="">All</button>
            <button class="filter-btn" data-filter="pending">Pending</button>
            <button class="filter-btn" data-filter="processing">Processing</button>
            <button class="filter-btn" data-filter="completed">Completed</button>
            <button class="filter-btn" data-filter="failed">Failed</button>
          </div>
          <button class="refresh-btn" id="refresh-btn">
            <span class="refresh-icon">↻</span> Refresh
          </button>
        </div>

        <!-- Image Grid -->
        <div class="image-grid" id="image-grid"></div>

        <!-- Pagination -->
        <div class="pagination" id="pagination"></div>
      </div>
    </section>

    <!-- Detail Modal -->
    <div class="modal-overlay" id="modal-overlay">
      <div class="modal">
        <div class="modal-header">
          <h2 class="modal-title" id="modal-title">Image Details</h2>
          <button class="modal-close" id="modal-close">✕</button>
        </div>
        <div class="modal-body" id="modal-body">
          <!-- Filled dynamically -->
        </div>
      </div>
    </div>

    <!-- Toast container -->
    <div class="toast-container" id="toast-container"></div>
  `;

  bindEvents();
  checkHealth();
  loadImages();
}

/* ----------------------------------------------------------
   Render: Image Grid
   ---------------------------------------------------------- */
function renderImageGrid() {
  const grid = document.getElementById('image-grid');

  if (state.isLoading) {
    grid.innerHTML = Array(4)
      .fill('<div class="skeleton skeleton-card"></div>')
      .join('');
    return;
  }

  if (state.images.length === 0) {
    grid.innerHTML = `
      <div class="empty-state" style="grid-column: 1 / -1">
        <div class="empty-icon">📭</div>
        <div class="empty-title">No images found</div>
        <div class="empty-subtitle">
          ${state.filter ? 'Try a different filter or upload a new image.' : 'Upload your first vehicle image to get started.'}
        </div>
      </div>
    `;
    return;
  }

  grid.innerHTML = state.images.map((img) => renderImageCard(img)).join('');
}

function renderImageCard(img) {
  const analysis = img.analysisResult;
  const hasResults = img.status === 'completed' && analysis;
  const overallStatus = hasResults ? analysis.overallStatus : null;
  const issues = hasResults ? (analysis.issuesFound || []) : [];
  const score = hasResults ? analysis.confidenceScore : null;
  const checks = hasResults ? (analysis.checks || []) : [];

  // Build issue chips showing only failed checks
  const failedChecks = checks.filter((c) => !c.passed);
  const issueChips = failedChecks
    .slice(0, 3)
    .map(
      (c) =>
        `<span class="issue-chip ${c.severity || 'low'}">${formatCheckName(c.check)}</span>`
    )
    .join('');
  const moreCount = failedChecks.length > 3 ? `<span class="issue-chip low">+${failedChecks.length - 3} more</span>` : '';

  // Score bar
  let scoreBar = '';
  if (score !== null) {
    const pct = Math.round(score * 100);
    scoreBar = `
      <div class="card-score">
        <span class="score-label" style="color: ${getScoreColor(score)}">${pct}%</span>
        <div class="score-bar-bg">
          <div class="score-bar-fill" style="width: ${pct}%; background: ${getScoreColor(score)}"></div>
        </div>
      </div>
    `;
  }

  // Overall badge
  const overallBadge = overallStatus
    ? `<span class="card-overall-badge ${overallStatus}">${overallStatus === 'clean' ? '✓ Clean' : '⚠ Flagged'}</span>`
    : '';

  return `
    <div class="image-card" data-id="${img.id}" onclick="window.__openModal('${img.id}')">
      <div class="card-image-wrapper">
        <img src="http://localhost:3000/uploads/${img.storedFilename}" alt="${img.originalName}"
             onerror="this.style.display='none'; this.parentElement.innerHTML='<div style=\\'display:flex;align-items:center;justify-content:center;height:100%;font-size:2.5rem;opacity:0.3\\'>🖼️</div>'" />
        <span class="card-status-badge ${img.status}">${img.status}</span>
        ${overallBadge}
      </div>
      <div class="card-body">
        <div class="card-filename" title="${img.originalName}">${img.originalName}</div>
        <div class="card-meta">
          <span>${formatBytes(img.sizeBytes)}</span>
          <span>•</span>
          <span>${timeAgo(img.uploadedAt)}</span>
          ${img.attempts > 0 ? `<span>• ${img.attempts} attempt${img.attempts > 1 ? 's' : ''}</span>` : ''}
        </div>
        ${issueChips || moreCount ? `<div class="card-issues">${issueChips}${moreCount}</div>` : ''}
        ${scoreBar}
      </div>
    </div>
  `;
}

/* ----------------------------------------------------------
   Render: Stats
   ---------------------------------------------------------- */
function renderStats() {
  // Count statuses from all loaded images — but also show total from API
  const completed = state.images.filter((i) => i.status === 'completed').length;
  const flagged = state.images.filter(
    (i) => i.status === 'completed' && i.analysisResult?.overallStatus === 'flagged'
  ).length;
  const inQueue = state.images.filter(
    (i) => i.status === 'pending' || i.status === 'processing'
  ).length;

  document.getElementById('stat-total').textContent = state.total;
  document.getElementById('stat-completed').textContent = completed;
  document.getElementById('stat-flagged').textContent = flagged;
  document.getElementById('stat-pending').textContent = inQueue;
}

/* ----------------------------------------------------------
   Render: Pagination
   ---------------------------------------------------------- */
function renderPagination() {
  const pag = document.getElementById('pagination');
  const totalPages = Math.ceil(state.total / state.limit) || 1;
  const currentPage = Math.floor(state.offset / state.limit) + 1;

  if (totalPages <= 1) {
    pag.innerHTML = '';
    return;
  }

  pag.innerHTML = `
    <button class="page-btn" id="prev-page" ${currentPage <= 1 ? 'disabled' : ''}>← Previous</button>
    <span class="page-info">Page ${currentPage} of ${totalPages}</span>
    <button class="page-btn" id="next-page" ${currentPage >= totalPages ? 'disabled' : ''}>Next →</button>
  `;

  document.getElementById('prev-page')?.addEventListener('click', () => {
    state.offset = Math.max(0, state.offset - state.limit);
    loadImages();
  });
  document.getElementById('next-page')?.addEventListener('click', () => {
    state.offset += state.limit;
    loadImages();
  });
}

/* ----------------------------------------------------------
   Render: Detail Modal
   ---------------------------------------------------------- */
async function openModal(imageId) {
  const overlay = document.getElementById('modal-overlay');
  const body = document.getElementById('modal-body');
  const title = document.getElementById('modal-title');

  overlay.classList.add('active');
  document.body.style.overflow = 'hidden';

  // Find image in local state first
  let img = state.images.find((i) => i.id === imageId);

  title.textContent = img ? img.originalName : 'Loading...';

  // If still processing, show spinner and poll
  if (img && (img.status === 'pending' || img.status === 'processing')) {
    body.innerHTML = renderModalPending(img);
    pollForCompletion(imageId);
    return;
  }

  // If failed
  if (img && img.status === 'failed') {
    let failure = null;
    try { failure = await getImageFailure(imageId); } catch { /* ignore */ }
    body.innerHTML = renderModalFailed(img, failure);
    return;
  }

  // Completed — get results
  if (img && img.status === 'completed') {
    try {
      const results = await getImageResults(imageId);
      body.innerHTML = renderModalCompleted(img, results);
      bindDetailToggles();
    } catch (e) {
      body.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><div class="empty-title">Error loading results</div><div class="empty-subtitle">${e.message}</div></div>`;
    }
    return;
  }

  // Fallback — fetch status
  try {
    const statusData = await getImageStatus(imageId);
    body.innerHTML = `<pre style="color: var(--color-text-secondary); font-size: 0.85rem;">${JSON.stringify(statusData, null, 2)}</pre>`;
  } catch (e) {
    body.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><div class="empty-title">Could not load image</div></div>`;
  }
}

// Expose to inline onclick
window.__openModal = openModal;

function closeModal() {
  document.getElementById('modal-overlay').classList.remove('active');
  document.body.style.overflow = '';
}

function renderModalPending(img) {
  return `
    <img class="modal-image-preview" src="http://localhost:3000/uploads/${img.storedFilename}" alt="${img.originalName}"
         onerror="this.style.display='none'" />
    <div class="modal-info-grid">
      ${infoItem('Status', img.status)}
      ${infoItem('Size', formatBytes(img.sizeBytes))}
      ${infoItem('Type', img.mimeType)}
      ${infoItem('Uploaded', timeAgo(img.uploadedAt))}
    </div>
    <div class="processing-indicator">
      <div class="processing-spinner"></div>
      <div class="processing-text">Analysis in progress… This page will update automatically.</div>
    </div>
  `;
}

function renderModalFailed(img, failure) {
  return `
    <img class="modal-image-preview" src="http://localhost:3000/uploads/${img.storedFilename}" alt="${img.originalName}"
         onerror="this.style.display='none'" />
    <div class="modal-info-grid">
      ${infoItem('Status', 'Failed')}
      ${infoItem('Attempts', img.attempts || '—')}
      ${infoItem('Size', formatBytes(img.sizeBytes))}
      ${infoItem('Type', img.mimeType)}
    </div>
    <div class="failure-display">
      <h3>⚠ Processing Failed</h3>
      <p>${failure?.failureReason || img.failureReason || 'Unknown error'}</p>
    </div>
  `;
}

function renderModalCompleted(img, results) {
  const analysis = results.analysis || img.analysisResult;
  if (!analysis) return '<div class="empty-state"><div class="empty-icon">🤷</div><div class="empty-title">No analysis data</div></div>';

  const checks = analysis.checks || [];
  const overall = analysis.overallStatus;
  const score = analysis.confidenceScore;
  const issues = analysis.issuesFound || [];

  return `
    <img class="modal-image-preview" src="http://localhost:3000/uploads/${img.storedFilename}" alt="${img.originalName}"
         onerror="this.style.display='none'" />

    <div class="modal-info-grid">
      ${infoItem('File', img.originalName)}
      ${infoItem('Size', formatBytes(img.sizeBytes))}
      ${infoItem('Type', img.mimeType)}
      ${infoItem('Uploaded', new Date(img.uploadedAt).toLocaleString())}
      ${infoItem('Processed', results.processedAt ? new Date(results.processedAt).toLocaleString() : '—')}
      ${infoItem('Confidence', score !== undefined ? Math.round(score * 100) + '%' : '—')}
    </div>

    <!-- Overall Summary -->
    <div class="overall-summary ${overall}">
      <div class="overall-icon">${overall === 'clean' ? '✅' : '⚠️'}</div>
      <div class="overall-details">
        <h3>${overall === 'clean' ? 'Image Passed All Checks' : `${issues.length} Issue${issues.length !== 1 ? 's' : ''} Detected`}</h3>
        <p>${overall === 'clean'
          ? 'No quality or authenticity concerns were found.'
          : `Flagged checks: ${issues.map(formatCheckName).join(', ')}`
        }</p>
      </div>
    </div>

    <!-- Individual Checks -->
    <h3 class="checks-title">Analysis Checks (${checks.length})</h3>
    ${checks.map((c) => renderCheckItem(c)).join('')}
  `;
}

function renderCheckItem(check) {
  const iconClass = check.passed ? 'passed' : (check.severity === 'medium' ? 'warning' : 'failed');
  const statusSymbol = check.passed ? '✓' : '✕';
  const details = check.details || {};
  const detailRows = Object.entries(details)
    .map(([k, v]) => `
      <div class="detail-row">
        <span class="detail-key">${k}</span>
        <span class="detail-value">${typeof v === 'object' ? JSON.stringify(v) : String(v)}</span>
      </div>
    `)
    .join('');

  return `
    <div class="check-item">
      <div class="check-header">
        <div class="check-icon ${iconClass}">${getCheckIcon(check)}</div>
        <span class="check-name">${formatCheckName(check.check)}</span>
        <span class="check-icon ${iconClass}" style="width:auto;height:auto;background:none;font-size:0.85rem">${statusSymbol}</span>
        ${check.severity ? `<span class="check-severity ${check.severity}">${check.severity}</span>` : ''}
      </div>
      <div class="check-message">${check.message || '—'}</div>
      ${detailRows ? `
        <button class="check-details-toggle" data-target="${check.check}">Show Details ▾</button>
        <div class="check-details">
          <div class="check-details-content" id="details-${check.check}">
            ${detailRows}
          </div>
        </div>
      ` : ''}
    </div>
  `;
}

function infoItem(label, value) {
  return `
    <div class="info-item">
      <div class="info-label">${label}</div>
      <div class="info-value">${value}</div>
    </div>
  `;
}

function bindDetailToggles() {
  document.querySelectorAll('.check-details-toggle').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const target = btn.getAttribute('data-target');
      const content = document.getElementById(`details-${target}`);
      if (content) {
        content.classList.toggle('expanded');
        btn.textContent = content.classList.contains('expanded') ? 'Hide Details ▴' : 'Show Details ▾';
      }
    });
  });
}

/* ----------------------------------------------------------
   Data Loading
   ---------------------------------------------------------- */
async function loadImages() {
  state.isLoading = true;
  renderImageGrid();

  try {
    const data = await listImages({
      status: state.filter,
      limit: state.limit,
      offset: state.offset,
    });
    state.images = data.items;
    state.total = data.total;

    // Auto-poll for pending/processing images
    state.images.forEach((img) => {
      if ((img.status === 'pending' || img.status === 'processing') && !state.pollingIds.has(img.id)) {
        pollForCompletion(img.id);
      }
    });
  } catch (e) {
    showToast('Failed to load images: ' + e.message, 'error');
  } finally {
    state.isLoading = false;
    renderImageGrid();
    renderStats();
    renderPagination();
  }
}

/* ----------------------------------------------------------
   Polling — watches pending/processing images
   ---------------------------------------------------------- */
function pollForCompletion(imageId) {
  if (state.pollingIds.has(imageId)) return;
  state.pollingIds.add(imageId);

  const interval = setInterval(async () => {
    try {
      const statusData = await getImageStatus(imageId);

      if (statusData.status === 'completed' || statusData.status === 'failed') {
        clearInterval(interval);
        state.pollingIds.delete(imageId);

        // Refresh the list to get updated data
        await loadImages();

        if (statusData.status === 'completed') {
          showToast('Image analysis complete!', 'success');
        } else {
          showToast('Image processing failed.', 'error');
        }

        // If modal is open for this image, refresh it
        const overlay = document.getElementById('modal-overlay');
        if (overlay.classList.contains('active')) {
          openModal(imageId);
        }
      }
    } catch {
      // Silently retry
    }
  }, 2000);
}

/* ----------------------------------------------------------
   Health Check
   ---------------------------------------------------------- */
async function checkHealth() {
  state.isOnline = await healthCheck();
  const dot = document.getElementById('status-dot');
  const text = document.getElementById('status-text');
  if (state.isOnline) {
    dot.classList.remove('offline');
    text.textContent = 'API Connected';
  } else {
    dot.classList.add('offline');
    text.textContent = 'API Offline';
  }
}

// Re-check health every 30s
setInterval(checkHealth, 30000);

/* ----------------------------------------------------------
   Upload Handling
   ---------------------------------------------------------- */
async function handleUpload(file) {
  if (!file) return;

  const validTypes = ['image/jpeg', 'image/png', 'image/webp'];
  if (!validTypes.includes(file.type)) {
    showToast('Unsupported file type. Use JPEG, PNG, or WebP.', 'error');
    return;
  }

  const maxSize = 15 * 1024 * 1024;
  if (file.size > maxSize) {
    showToast('File too large. Maximum 15 MB.', 'error');
    return;
  }

  const progress = document.getElementById('upload-progress');
  const bar = document.getElementById('progress-bar');
  const text = document.getElementById('progress-text');

  progress.classList.add('active');
  bar.style.width = '20%';
  text.textContent = `Uploading ${file.name}...`;

  try {
    bar.style.width = '60%';
    const result = await uploadImage(file);
    bar.style.width = '100%';
    text.textContent = 'Upload complete! Queued for analysis.';

    showToast(`"${file.name}" uploaded and queued for analysis.`, 'success');

    // Reset filter and reload
    state.filter = null;
    state.offset = 0;
    updateFilterButtons();
    await loadImages();

    // Start polling for this new image
    pollForCompletion(result.id);

    setTimeout(() => {
      progress.classList.remove('active');
      bar.style.width = '0%';
    }, 2000);
  } catch (e) {
    bar.style.width = '0%';
    text.textContent = 'Upload failed.';
    showToast('Upload failed: ' + e.message, 'error');
    setTimeout(() => progress.classList.remove('active'), 2000);
  }
}

/* ----------------------------------------------------------
   Event Binding
   ---------------------------------------------------------- */
function bindEvents() {
  // Upload zone click + drag
  const zone = document.getElementById('upload-zone');
  const input = document.getElementById('upload-input');

  zone.addEventListener('click', () => input.click());

  input.addEventListener('change', (e) => {
    if (e.target.files.length > 0) handleUpload(e.target.files[0]);
    e.target.value = ''; // reset
  });

  zone.addEventListener('dragover', (e) => {
    e.preventDefault();
    zone.classList.add('drag-over');
  });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.classList.remove('drag-over');
    if (e.dataTransfer.files.length > 0) handleUpload(e.dataTransfer.files[0]);
  });

  // Filters
  document.getElementById('filter-group').addEventListener('click', (e) => {
    if (e.target.classList.contains('filter-btn')) {
      const filter = e.target.getAttribute('data-filter') || null;
      state.filter = filter;
      state.offset = 0;
      updateFilterButtons();
      loadImages();
    }
  });

  // Refresh
  document.getElementById('refresh-btn').addEventListener('click', async () => {
    const btn = document.getElementById('refresh-btn');
    btn.classList.add('spinning');
    await loadImages();
    await checkHealth();
    setTimeout(() => btn.classList.remove('spinning'), 600);
  });

  // Modal close
  document.getElementById('modal-close').addEventListener('click', closeModal);
  document.getElementById('modal-overlay').addEventListener('click', (e) => {
    if (e.target === document.getElementById('modal-overlay')) closeModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeModal();
  });
}

function updateFilterButtons() {
  document.querySelectorAll('.filter-btn').forEach((btn) => {
    const f = btn.getAttribute('data-filter') || null;
    btn.classList.toggle('active', f === state.filter);
  });
}

/* ----------------------------------------------------------
   Boot
   ---------------------------------------------------------- */
renderApp();
