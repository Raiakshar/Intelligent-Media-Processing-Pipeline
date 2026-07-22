/* ============================================================
    — Vehicle Computer Vision & License Plate Inspection Platform
   Full Single-Page Application Module
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
   Helpers
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
  if (seconds < 60) return 'JUST NOW';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}M AGO`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}H AGO`;
  return `${Math.floor(seconds / 86400)}D AGO`;
}

function formatCheckName(name) {
  const names = {
    ocr_plate_validation: 'ALPR License Plate OCR',
    blur_detection: 'Laplacian Blur Detection',
    brightness_analysis: 'Grayscale Luminance',
    dimension_validation: 'Resolution Bounds',
    duplicate_detection: 'SHA256 & aHash Duplicates',
    screenshot_rephoto_heuristic: 'Screenshot Heuristics',
    metadata_analysis: 'EXIF Integrity',
    tampering_heuristic: 'ELA Tampering Analysis',
  };
  return names[name] || name.replace(/_/g, ' ').toUpperCase();
}

function extractPlateData(checks) {
  if (!checks || !Array.isArray(checks)) return null;
  const ocrCheck = checks.find((c) => c.check === 'ocr_plate_validation');
  if (ocrCheck && ocrCheck.passed && ocrCheck.details?.extractedPlate) {
    return {
      plate: ocrCheck.details.extractedPlate,
      state: ocrCheck.details.stateCode || '',
      rto: ocrCheck.details.rtoCode || '',
      series: ocrCheck.details.seriesCode || '',
      number: ocrCheck.details.uniqueNumber || '',
    };
  }
  return null;
}

/* ----------------------------------------------------------
   Toast Stack
   ---------------------------------------------------------- */
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-stack');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast-item ${type}`;
  toast.innerHTML = `
    <span>${type === 'success' ? '✓' : type === 'error' ? '✕' : 'ℹ'}</span>
    <span style="flex:1;">${message}</span>
  `;

  container.appendChild(toast);
  setTimeout(() => toast.remove(), 4500);
}

/* ----------------------------------------------------------
   Render Main Application Frame
   ---------------------------------------------------------- */
function renderApp() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <!-- Top Telemetry Navbar -->
    <nav class="navbar">
      <div class="container">
        <div class="brand-block">
          <div class="brand-icon">A</div>
          <div class="brand-text">
            <span class="brand-title">
              Intelligent analizer
            </span>
            <span class="brand-subtitle">Vehicle Vision & Quality Inspection System</span>
          </div>
        </div>
        <div class="telemetry-status">
          <div class="status-indicator">
            <span class="status-dot" id="status-dot"></span>
            <span id="status-text">CONNECTING</span>
          </div>
        </div>
      </div>
    </nav>

    <!-- Hero Studio Header & Reticle Upload Zone -->
    <section class="hero-section">
      <div class="container">
        <div class="hero-header">
          <div class="hero-badge">
             ASYNCHRONOUS DEEP FORENSICS & ALPR ENGINE
          </div>
          <h1 class="hero-title">
            Automated Vehicle <span>Inspection & Plate Recognition</span>
          </h1>
          <p class="hero-desc">
            High-concurrency media processing pipeline featuring Laplacian blur checks, ELA tampering analysis, near-duplicate hashing, and full Indian registration plate OCR.
          </p>
        </div>

        <!-- Upload Studio Box -->
        <div class="upload-studio" id="upload-studio">
          <div class="corner-reticle reticle-tl"></div>
          <div class="corner-reticle reticle-tr"></div>
          <div class="corner-reticle reticle-bl"></div>
          <div class="corner-reticle reticle-br"></div>

          <div class="studio-content">
            <div class="upload-icon-wrapper">📷</div>
            <div class="upload-heading">Drop Vehicle Media to Inspect</div>
            <div class="upload-sub">SUPPORTED INPUTS UP TO 15MB MAX</div>
            <div class="format-tags">
              <span class="tag-spec">JPEG</span>
              <span class="tag-spec">PNG</span>
              <span class="tag-spec">WEBP</span>
            </div>
          </div>
          <input type="file" class="upload-input" id="upload-input" accept="image/jpeg,image/png,image/webp" />
        </div>

        <!-- Velocity Progress Meter -->
        <div class="upload-velocity-bar" id="upload-velocity-bar">
          <div class="meter-track">
            <div class="meter-fill" id="meter-fill"></div>
          </div>
          <div class="meter-label">
            <span id="meter-status-text">INGESTING FILE...</span>
            <span id="meter-pct">0%</span>
          </div>
        </div>
      </div>
    </section>

    <!-- Metrics Telemetry Dashboard -->
    <section class="container">
      <div class="metrics-strip">
        <div class="metric-box total">
          <div class="metric-num" id="m-total">0</div>
          <div class="metric-label">Total Audited</div>
        </div>
        <div class="metric-box pass">
          <div class="metric-num" id="m-completed" style="color: var(--status-pass)">0</div>
          <div class="metric-label">Clean Submissions</div>
        </div>
        <div class="metric-box warn">
          <div class="metric-num" id="m-flagged" style="color: var(--status-warn)">0</div>
          <div class="metric-label">Flagged Issues</div>
        </div>
        <div class="metric-box pending">
          <div class="metric-num" id="m-queue" style="color: var(--status-pending)">0</div>
          <div class="metric-label">Active Queue Depth</div>
        </div>
      </div>

      <!-- Controls & Toolbar -->
      <div class="controls-toolbar">
        <div class="filter-segments" id="filter-segments">
          <button class="segment-btn active" data-filter="">ALL RECORDS</button>
          <button class="segment-btn" data-filter="pending">PENDING</button>
          <button class="segment-btn" data-filter="processing">PROCESSING</button>
          <button class="segment-btn" data-filter="completed">COMPLETED</button>
          <button class="segment-btn" data-filter="failed">FAILED</button>
        </div>
        <button class="refresh-trigger" id="refresh-trigger">
          <span class="refresh-icon">↻</span> RE-SYNC DATA
        </button>
      </div>

      <!-- Vehicle Cards Inspection Grid -->
      <div class="inspection-grid" id="inspection-grid"></div>
    </section>

    <!-- Split-Pane Forensic Modal Studio -->
    <div class="modal-overlay" id="modal-overlay">
      <div class="modal-window">
        <div class="modal-header-bar">
          <div class="modal-title-wrap">
            <span class="modal-title-text" id="modal-filename">INSPECTION FILE DETAILS</span>
          </div>
          <button class="modal-close-trigger" id="modal-close">✕</button>
        </div>
        <div class="modal-split-body" id="modal-split-body">
          <!-- Filled dynamically -->
        </div>
      </div>
    </div>

    <!-- Toast Stack -->
    <div class="toast-stack" id="toast-stack"></div>
  `;

  bindEvents();
  checkSystemHealth();
  loadInspectionData();
}

/* ----------------------------------------------------------
   Render: Grid & Vehicle Cards
   ---------------------------------------------------------- */
function renderInspectionGrid() {
  const grid = document.getElementById('inspection-grid');

  if (state.isLoading) {
    grid.innerHTML = Array(6)
      .fill('<div class="skeleton-card"></div>')
      .join('');
    return;
  }

  if (state.images.length === 0) {
    grid.innerHTML = `
      <div style="grid-column: 1 / -1; text-align: center; padding: 5rem 1rem; color: #64748b; background: var(--bg-surface); border: 1px dashed var(--border-default); border-radius: 12px;">
        <div style="font-size: 2.5rem; margin-bottom: 0.75rem;">📭</div>
        <div style="font-size: 1.125rem; font-weight: 600; color: #cbd5e1; margin-bottom: 0.25rem;">No Inspection Records</div>
        <div style="font-size: 0.8125rem;">Upload a vehicle image to trigger automatic ALPR & computer vision verification.</div>
      </div>
    `;
    return;
  }

  grid.innerHTML = state.images.map((img) => renderVehicleCard(img)).join('');
}

function renderVehicleCard(img) {
  const analysis = img.analysisResult;
  const isDone = img.status === 'completed' && analysis;
  const overall = isDone ? analysis.overallStatus : null;
  const score = isDone ? analysis.confidenceScore : null;
  const checks = isDone ? (analysis.checks || []) : [];

  // Extract Plate Data if available
  const plateData = extractPlateData(img);
  const plateBadgeHtml = plateData
    ? `<div class="plate-spotlight-badge" title="Extracted Vehicle Plate">${plateData.plate}</div>`
    : '';

  // Failed check tags
  const failedChecks = checks.filter((c) => !c.passed);
  const checkTagsHtml = failedChecks
    .slice(0, 3)
    .map((c) => `<span class="check-tag ${c.severity || 'low'}">${c.check.replace('_', ' ').toUpperCase()}</span>`)
    .join('');

  // Confidence meter fill
  let meterHtml = '';
  if (score !== null) {
    const pct = Math.round(score * 100);
    const color = pct >= 80 ? 'var(--status-pass)' : pct >= 50 ? 'var(--status-warn)' : 'var(--status-fail)';
    meterHtml = `
      <div class="score-meter">
        <span class="meter-score-text" style="color: ${color}">${pct}% ACCURACY</span>
        <div class="meter-track-mini">
          <div class="meter-fill-mini" style="width: ${pct}%; background: ${color}"></div>
        </div>
      </div>
    `;
  }

  return `
    <div class="vehicle-card" onclick="window.__openForensicModal('${img.id}')">
      <div class="card-viewport">
        <img src="https://intelligent-media-processing-pipeline-q20l.onrender.com/uploads/${img.storedFilename}" alt="${img.originalName}"
             onerror="this.style.display='none';" />
        <span class="card-status-pill ${img.status}">${img.status}</span>
        ${plateBadgeHtml}
      </div>
      <div class="card-details-body">
        <div class="card-filename-row">
          <span class="card-filename" title="${img.originalName}">${img.originalName}</span>
          <span class="card-timestamp">${timeAgo(img.uploadedAt)}</span>
        </div>
        <div class="card-meta-bar">
          <span>${formatBytes(img.sizeBytes)}</span>
          <span>•</span>
          <span>${img.mimeType ? img.mimeType.split('/')[1].toUpperCase() : 'IMG'}</span>
        </div>
        ${checkTagsHtml ? `<div class="check-tags-list">${checkTagsHtml}</div>` : ''}
        ${meterHtml}
      </div>
    </div>
  `;
}

/* ----------------------------------------------------------
   Render: Telemetry Stats
   ---------------------------------------------------------- */
function updateTelemetryStats() {
  const completed = state.images.filter((i) => i.status === 'completed').length;
  const flagged = state.images.filter(
    (i) => i.status === 'completed' && i.analysisResult?.overallStatus === 'flagged'
  ).length;
  const inQueue = state.images.filter(
    (i) => i.status === 'pending' || i.status === 'processing'
  ).length;

  document.getElementById('m-total').textContent = state.total;
  document.getElementById('m-completed').textContent = completed;
  document.getElementById('m-flagged').textContent = flagged;
  document.getElementById('m-queue').textContent = inQueue;
}

/* ----------------------------------------------------------
   Render: Split-Pane Forensic Modal
   ---------------------------------------------------------- */
async function openForensicModal(imageId) {
  const overlay = document.getElementById('modal-overlay');
  const splitBody = document.getElementById('modal-split-body');
  const title = document.getElementById('modal-filename');

  overlay.classList.add('active');
  document.body.style.overflow = 'hidden';

  const img = state.images.find((i) => i.id === imageId);

  title.textContent = img ? `INSPECTION FILE: ${img.originalName}` : 'INSPECTING IMAGE...';

  if (!img) return;

  // Pending / Processing view
  if (img.status === 'pending' || img.status === 'processing') {
    splitBody.innerHTML = `
      <div class="pane-viewport">
        <img class="inspection-canvas" src="https://intelligent-media-processing-pipeline-q20l.onrender.com/uploads/${img.storedFilename}" />
        <div class="file-info-table">
          <div><div class="info-cell-label">FILE SIZE</div><div class="info-cell-val">${formatBytes(img.sizeBytes)}</div></div>
          <div><div class="info-cell-label">MIME TYPE</div><div class="info-cell-val">${img.mimeType}</div></div>
        </div>
      </div>
      <div class="pane-diagnostics" style="justify-content:center; align-items:center; text-align:center;">
        <div style="font-size: 2rem; animation: spin 1s linear infinite;">↻</div>
        <div style="font-weight: 600; color: #f1f5f9; margin-top: 1rem;">COMPUTER VISION ANALYSIS IN PROGRESS</div>
        <div style="font-size: 0.8125rem; color: #64748b; margin-top: 0.25rem;">Running Laplacian blur, ELA diffs, and WASM Tesseract OCR...</div>
      </div>
    `;
    pollImageStatus(imageId);
    return;
  }

  // Failed view
  if (img.status === 'failed') {
    let failure = null;
    try { failure = await getImageFailure(imageId); } catch { /* ignore */ }
    splitBody.innerHTML = `
      <div class="pane-viewport">
        <img class="inspection-canvas" src="https://intelligent-media-processing-pipeline-q20l.onrender.com/uploads/${img.storedFilename}" />
      </div>
      <div class="pane-diagnostics">
        <div style="background: var(--status-fail-bg); border: 1px solid var(--status-fail-border); padding: 1.25rem; border-radius: 10px; color: var(--status-fail);">
          <div style="font-weight: 700; font-size: 1rem; margin-bottom: 0.5rem;">Processing Failure</div>
          <div style="font-family: var(--font-mono); font-size: 0.8125rem;">${failure?.failureReason || img.failureReason || 'Worker exception'}</div>
        </div>
      </div>
    `;
    return;
  }

  // Completed View — Fetch full results
  try {
    const results = await getImageResults(imageId);
    const analysis = results.analysis || img.analysisResult;
    const checks = analysis?.checks || [];
    const overall = analysis?.overallStatus || 'clean';
    const plateData = extractPlateData(checks);

    // Render ALPR Card if plate found
    let alprCardHtml = '';
    if (plateData) {
      alprCardHtml = `
        <div class="alpr-spotlight-card">
          <div>
            <div style="font-size: 0.6875rem; color: #ca8a04; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 4px;">
              ⚡ EXTRACTED LICENSE PLATE (ALPR)
            </div>
            <div class="alpr-plate-display">${plateData.plate}</div>
          </div>
          <div class="alpr-details-grid">
            <div class="alpr-chip"><span class="alpr-chip-key">STATE</span><span class="alpr-chip-val">${plateData.state}</span></div>
            <div class="alpr-chip"><span class="alpr-chip-key">RTO</span><span class="alpr-chip-val">${plateData.rto}</span></div>
            <div class="alpr-chip"><span class="alpr-chip-key">NUM</span><span class="alpr-chip-val">${plateData.number}</span></div>
          </div>
        </div>
      `;
    }

    const checksHtml = checks.map((c) => `
      <div class="check-row-card">
        <div class="check-row-header">
          <div class="check-title-group">
            <div class="check-status-icon ${c.passed ? 'pass' : 'fail'}">${c.passed ? '✓' : '✕'}</div>
            <span class="check-name-text">${formatCheckName(c.check)}</span>
          </div>
          ${c.severity && c.severity !== 'none' ? `<span class="check-tag ${c.severity}">${c.severity.toUpperCase()}</span>` : ''}
        </div>
        <div class="check-msg">${c.message || ''}</div>
        ${c.details ? `
          <button class="json-detail-toggle" onclick="this.nextElementSibling.classList.toggle('open')">{ } View Raw Diagnostic Payload</button>
          <div class="json-detail-box">${JSON.stringify(c.details, null, 2)}</div>
        ` : ''}
      </div>
    `).join('');

    splitBody.innerHTML = `
      <div class="pane-viewport">
        <img class="inspection-canvas" src="https://intelligent-media-processing-pipeline-q20l.onrender.com/uploads/${img.storedFilename}" />
        <div class="file-info-table">
          <div><div class="info-cell-label">FILE SIZE</div><div class="info-cell-val">${formatBytes(img.sizeBytes)}</div></div>
          <div><div class="info-cell-label">MIME TYPE</div><div class="info-cell-val">${img.mimeType}</div></div>
          <div><div class="info-cell-label">ACCURACY SCORE</div><div class="info-cell-val">${Math.round((analysis.confidenceScore || 0) * 100)}%</div></div>
          <div><div class="info-cell-label">ATTEMPTS</div><div class="info-cell-val">${img.attempts || 1}</div></div>
        </div>
      </div>
      <div class="pane-diagnostics">
        ${alprCardHtml}

        <div class="status-banner ${overall}">
          <div>
            <div class="status-banner-title">${overall === 'clean' ? 'Vehicle Inspection Verified Clean' : 'Quality / Forensic Issues Flagged'}</div>
            <div class="status-banner-sub">${overall === 'clean' ? 'All 8 computer vision heuristics passed bounds.' : `${(analysis.issuesFound || []).length} check(s) flagged review.`}</div>
          </div>
        </div>

        <div style="font-weight: 700; font-size: 0.875rem; color: #f1f5f9; text-transform: uppercase; letter-spacing: 0.05em; margin-top: 0.5rem;">
          Detailed Diagnostics Breakdown (${checks.length})
        </div>
        ${checksHtml}
      </div>
    `;

  } catch (e) {
    splitBody.innerHTML = `<div style="padding: 2rem; color: var(--status-fail);">Failed to load forensic data: ${e.message}</div>`;
  }
}

window.__openForensicModal = openForensicModal;

function closeModal() {
  document.getElementById('modal-overlay').classList.remove('active');
  document.body.style.overflow = '';
}

/* ----------------------------------------------------------
   Data Ingestion & Loading
   ---------------------------------------------------------- */
async function loadInspectionData() {
  state.isLoading = true;
  renderInspectionGrid();

  try {
    const data = await listImages({
      status: state.filter,
      limit: state.limit,
      offset: state.offset,
    });
    state.images = data.items;
    state.total = data.total;

    // Auto poll pending
    state.images.forEach((img) => {
      if ((img.status === 'pending' || img.status === 'processing') && !state.pollingIds.has(img.id)) {
        pollImageStatus(img.id);
      }
    });
  } catch (e) {
    showToast('Failed to sync inspection records: ' + e.message, 'error');
  } finally {
    state.isLoading = false;
    renderInspectionGrid();
    updateTelemetryStats();
  }
}

function pollImageStatus(imageId) {
  if (state.pollingIds.has(imageId)) return;
  state.pollingIds.add(imageId);

  const interval = setInterval(async () => {
    try {
      const statusData = await getImageStatus(imageId);
      if (statusData.status === 'completed' || statusData.status === 'failed') {
        clearInterval(interval);
        state.pollingIds.delete(imageId);

        await loadInspectionData();
        showToast(`Image ${statusData.status === 'completed' ? 'analysis finished' : 'processing failed'}.`, statusData.status === 'completed' ? 'success' : 'error');

        const overlay = document.getElementById('modal-overlay');
        if (overlay.classList.contains('active')) {
          openForensicModal(imageId);
        }
      }
    } catch { /* retry */ }
  }, 2000);
}

/* ----------------------------------------------------------
   Health Checks
   ---------------------------------------------------------- */
async function checkSystemHealth() {
  state.isOnline = await healthCheck();
  const dot = document.getElementById('status-dot');
  const text = document.getElementById('status-text');
  if (state.isOnline) {
    dot.classList.remove('offline');
    text.textContent = 'SYSTEM ONLINE';
  } else {
    dot.classList.add('offline');
    text.textContent = 'API OFFLINE';
  }
}

setInterval(checkSystemHealth, 30000);

/* ----------------------------------------------------------
   Upload Actions
   ---------------------------------------------------------- */
async function processUploadFile(file) {
  if (!file) return;

  const bar = document.getElementById('upload-velocity-bar');
  const fill = document.getElementById('meter-fill');
  const text = document.getElementById('meter-status-text');
  const pct = document.getElementById('meter-pct');

  bar.classList.add('active');
  fill.style.width = '25%';
  text.textContent = `INGESTING ${file.name.toUpperCase()}...`;
  pct.textContent = '25%';

  try {
    fill.style.width = '70%';
    pct.textContent = '70%';
    const res = await uploadImage(file);

    fill.style.width = '100%';
    pct.textContent = '100%';
    text.textContent = 'UPLOAD SUCCESSFUL — ENQUEUED FOR ALPR';

    showToast(`Media queued for ALPR & forensic checks: ${file.name}`, 'success');

    state.filter = null;
    updateFilterButtons();
    await loadInspectionData();
    pollImageStatus(res.id);

    setTimeout(() => {
      bar.classList.remove('active');
      fill.style.width = '0%';
    }, 2000);
  } catch (e) {
    fill.style.width = '0%';
    text.textContent = 'INGESTION FAILED';
    showToast('Upload error: ' + e.message, 'error');
    setTimeout(() => bar.classList.remove('active'), 2500);
  }
}

/* ----------------------------------------------------------
   Events Setup
   ---------------------------------------------------------- */
function bindEvents() {
  const studio = document.getElementById('upload-studio');
  const input = document.getElementById('upload-input');

  studio.addEventListener('click', () => input.click());

  input.addEventListener('change', (e) => {
    if (e.target.files.length > 0) processUploadFile(e.target.files[0]);
    e.target.value = '';
  });

  studio.addEventListener('dragover', (e) => {
    e.preventDefault();
    studio.classList.add('drag-over');
  });

  studio.addEventListener('dragleave', () => studio.classList.remove('drag-over'));
  studio.addEventListener('drop', (e) => {
    e.preventDefault();
    studio.classList.remove('drag-over');
    if (e.dataTransfer.files.length > 0) processUploadFile(e.dataTransfer.files[0]);
  });

  // Filter toolbar
  document.getElementById('filter-segments').addEventListener('click', (e) => {
    if (e.target.classList.contains('segment-btn')) {
      state.filter = e.target.getAttribute('data-filter') || null;
      state.offset = 0;
      updateFilterButtons();
      loadInspectionData();
    }
  });

  // Re-sync trigger
  document.getElementById('refresh-trigger').addEventListener('click', async () => {
    const btn = document.getElementById('refresh-trigger');
    btn.classList.add('spinning');
    await loadInspectionData();
    await checkSystemHealth();
    setTimeout(() => btn.classList.remove('spinning'), 600);
  });

  // Modal actions
  document.getElementById('modal-close').addEventListener('click', closeModal);
  document.getElementById('modal-overlay').addEventListener('click', (e) => {
    if (e.target === document.getElementById('modal-overlay')) closeModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeModal();
  });
}

function updateFilterButtons() {
  document.querySelectorAll('.segment-btn').forEach((btn) => {
    const f = btn.getAttribute('data-filter') || null;
    btn.classList.toggle('active', f === state.filter);
  });
}

/* ----------------------------------------------------------
   Boot
   ---------------------------------------------------------- */
renderApp();
