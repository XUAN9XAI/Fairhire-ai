// API Base URL - uses relative path (works on Vercel and local dev)
const API_BASE = '/api';

const state = {
    fileUploaded: false,
    auditRun: false,
    candidateIds: [],
    metricsBefore: null,
    metricsAfter: null,
    uploadedFiles: [],
    activeFileIndex: 0,
    currentRows: 0,
    fullAuditData: null // Stores latest full audit for exports
};

// DOM Elements
const els = {
    tabs: document.querySelectorAll('.tab-content'),
    navItems: document.querySelectorAll('.nav-item'),
    pageTitle: document.getElementById('page-title'),
    dropZone: document.getElementById('drop-zone'),
    fileInput: document.getElementById('file-input'),
    configArea: document.getElementById('config-area'),
    targetCol: document.getElementById('target-col'),
    sensitiveCol: document.getElementById('sensitive-col'),
    fileNameDisplay: document.getElementById('file-name-display'),
    biasThreshold: document.getElementById('bias-threshold'),
    btnRunAudit: document.getElementById('btn-run-audit'),
    biasScoreDisplay: document.getElementById('bias-score-display'),
    biasStatusDisplay: document.getElementById('bias-status-display'),
    chartContainer: document.getElementById('selection-chart-container'),
    geminiExplanation: document.getElementById('gemini-explanation'),
    featureList: document.getElementById('feature-list'),
    geminiRootCause: document.getElementById('gemini-root-cause'),
    simCandidateSelect: document.getElementById('sim-candidate-select'),
    simTargetGroup: document.getElementById('sim-target-group'),
    simProbBadge: document.getElementById('sim-prob-badge'),
    btnSimulate: document.getElementById('btn-simulate'),
    
    // Compliance Metrics
    metricDP: document.getElementById('metric-dp'),
    metricEO: document.getElementById('metric-eo'),
    metricOdds: document.getElementById('metric-odds'),
    metricEEOC: document.getElementById('metric-eeoc'),
    simResults: document.getElementById('sim-results'),
    simProfileDetails: document.getElementById('sim-profile-details'),
    simExplanation: document.getElementById('sim-explanation'),
    btnMitigate: document.getElementById('btn-mitigate'),
    mitigationResults: document.getElementById('mitigation-results'),
    metricBefore: document.getElementById('metric-before'),
    metricAfter: document.getElementById('metric-after'),
    loader: document.getElementById('loader-overlay'),
    loaderText: document.getElementById('loader-text'),
    statusBadge: document.getElementById('status-badge'),
    btnRefresh: document.getElementById('btn-refresh'),
    datasetSelectGroup: document.getElementById('dataset-select-group'),
    datasetSelect: document.getElementById('dataset-select'),
    btnClearHistory: document.getElementById('btn-clear-history'),
    historyTableBody: document.getElementById('history-table-body'),
    noHistoryMsg: document.getElementById('no-history-msg'),
    fileInputAdd: document.getElementById('file-input-add'),
    validationArea: document.getElementById('validation-area'),
    validationList: document.getElementById('validation-list'),
    btnSampleDemo: document.getElementById('btn-sample-demo'),
    btnDownloadPdf: document.getElementById('btn-download-pdf'),
    pdfBtnText: document.getElementById('pdf-btn-text'),
    btnExportJson: document.getElementById('btn-export-json'),
    btnExportCsv: document.getElementById('btn-export-csv'),
    historyCompareArea: document.getElementById('history-comparison-area'),
    compareBiasChart: document.getElementById('compare-bias-chart'),
    compareFairnessChart: document.getElementById('compare-fairness-chart')
};

// --- Navigation & Routing ---

function switchTab(tabId) {
    // Hide all tabs, remove active from nav
    els.tabs.forEach(tab => tab.classList.remove('active'));
    els.navItems.forEach(nav => nav.classList.remove('active'));
    
    // Show target tab
    const tabEl = document.getElementById(`tab-${tabId}`);
    if (tabEl) tabEl.classList.add('active');
    const activeNav = document.querySelector(`.nav-item[data-tab="${tabId}"]`);
    if(activeNav) activeNav.classList.add('active');
    
    // Update header
    const titles = {
        'upload': 'Upload Dataset',
        'audit': 'Bias Audit Results',
        'explain': 'AI Explanation & Root Cause',
        'whatif': 'What-If Simulator',
        'impact': 'Fairness Mitigation',
        'history': 'Audit History'
    };
    els.pageTitle.textContent = titles[tabId] || 'FairHire AI';
    
    if (tabId === 'history') {
        renderHistory();
    }
    
    // Redraw chart when audit tab becomes visible (canvas needs visible container for dimensions)
    if (tabId === 'audit' && state.metricsBefore) {
        setTimeout(() => drawSelectionChart(state.metricsBefore), 50);
    }
}

function handleHashChange() {
    const hash = window.location.hash.replace('#', '') || 'upload';
    
    // History tab is always accessible
    if (hash === 'history') {
        switchTab(hash);
        return;
    }
    
    // Protection against jumping ahead
    if (hash !== 'upload' && !state.fileUploaded) {
        window.location.hash = 'upload';
        return;
    }
    if (['explain', 'whatif', 'impact'].includes(hash) && !state.auditRun) {
        window.location.hash = 'audit';
        return;
    }
    
    switchTab(hash);
}

window.addEventListener('hashchange', handleHashChange);
// Initial load
handleHashChange();

function showLoader(text) {
    els.loaderText.textContent = text;
    els.loader.classList.remove('hidden');
}
function hideLoader() {
    els.loader.classList.add('hidden');
}

// --- Tab 1: Upload ---

// Drag and drop events
els.dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    els.dropZone.classList.add('dragover');
});
els.dropZone.addEventListener('dragleave', () => {
    els.dropZone.classList.remove('dragover');
});
els.dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    els.dropZone.classList.remove('dragover');
    if (e.dataTransfer.files.length) {
        const droppedFiles = Array.from(e.dataTransfer.files).filter(f => f.name.endsWith('.csv'));
        if (droppedFiles.length) {
            state.uploadedFiles = droppedFiles;
            state.activeFileIndex = 0;
            updateDatasetSelector();
            uploadActiveFileToBackend();
        } else {
            alert("Please drop valid CSV files.");
        }
    }
});
els.fileInput.addEventListener('change', handleFileUpload);

if (els.btnRefresh) {
    els.btnRefresh.addEventListener('click', () => {
        state.fileUploaded = false;
        state.auditRun = false;
        state.uploadedFiles = [];
        state.activeFileIndex = 0;
        els.fileInput.value = '';
        if (els.fileInputAdd) els.fileInputAdd.value = '';
        els.configArea.classList.add('hidden');
        els.dropZone.classList.remove('hidden');
        els.statusBadge.textContent = "Awaiting Data";
        els.statusBadge.className = "badge";
        els.datasetSelectGroup.style.display = 'none';
        
        ['nav-audit', 'nav-explain', 'nav-whatif', 'nav-impact'].forEach(id => {
            document.getElementById(id).classList.add('disabled');
        });
    });
}

if (els.datasetSelect) {
    els.datasetSelect.addEventListener('change', (e) => {
        state.activeFileIndex = parseInt(e.target.value, 10);
        uploadActiveFileToBackend();
    });
}

if (els.fileInputAdd) {
    els.fileInputAdd.addEventListener('change', async () => {
        const files = Array.from(els.fileInputAdd.files);
        if (!files.length) return;
        
        const validFiles = files.filter(f => f.name.endsWith('.csv'));
        if (!validFiles.length) {
            alert("Please upload valid CSV files.");
            return;
        }

        // Append new files
        state.uploadedFiles = [...state.uploadedFiles, ...validFiles];
        
        // Update select dropdown — always show when more than 1
        updateDatasetSelector();
        
        // Clear the add input
        els.fileInputAdd.value = '';
        
        // Update the banner text
        els.fileNameDisplay.textContent = `${state.uploadedFiles.length} dataset(s) loaded`;
    });
}

function updateDatasetSelector() {
    if (state.uploadedFiles.length > 1) {
        els.datasetSelectGroup.style.display = 'block';
        els.datasetSelect.innerHTML = '';
        state.uploadedFiles.forEach((file, index) => {
            els.datasetSelect.add(new Option(file.name, index));
        });
        els.datasetSelect.value = state.activeFileIndex;
    } else {
        els.datasetSelectGroup.style.display = 'none';
    }
}

async function handleFileUpload() {
    const files = Array.from(els.fileInput.files);
    if (!files.length) return;
    
    const validFiles = files.filter(f => f.name.endsWith('.csv'));
    if (!validFiles.length) {
        alert("Please upload valid CSV files.");
        return;
    }

    state.uploadedFiles = validFiles;
    state.activeFileIndex = 0;
    
    updateDatasetSelector();
    await uploadActiveFileToBackend();
}

async function uploadActiveFileToBackend() {
    const file = state.uploadedFiles[state.activeFileIndex];
    if (!file) return;

    showLoader(`Analyzing ${file.name}...`);
    
    const formData = new FormData();
    formData.append("file", file);

    try {
        const response = await fetch(`${API_BASE}/upload`, {
            method: 'POST',
            body: formData
        });
        
        if (!response.ok) throw new Error(await response.text());
        
        const data = await response.json();
        state.currentRows = data.rows;
        
        // Populate dropdowns
        els.targetCol.innerHTML = '<option value="" disabled selected>Select Target Column</option>';
        els.sensitiveCol.innerHTML = '<option value="" disabled selected>Select Sensitive Attribute</option>';
        
        data.columns.forEach(col => {
            els.targetCol.add(new Option(col, col));
            els.sensitiveCol.add(new Option(col, col));
        });
        
        els.configArea.classList.remove('hidden');
        els.dropZone.classList.add('hidden');
        els.fileNameDisplay.textContent = `${file.name} loaded (${data.rows} rows)`;
            
        state.fileUploaded = true;
        state.currentRows = data.rows;
        els.statusBadge.textContent = "Data Ready";
        els.statusBadge.className = "badge status-pass";
        
        // Enable next nav item
        document.getElementById('nav-audit').classList.remove('disabled');

    } catch (err) {
        console.error(err);
        alert("Failed to upload file: " + err.message);
    } finally {
        hideLoader();
    }
}

// --- One-click Sample Demo ---

if (els.btnSampleDemo) {
    els.btnSampleDemo.addEventListener('click', async () => {
        showLoader("Running Prototype Demo...");
        
        try {
            const response = await fetch(`${API_BASE}/audit/sample`, {
                method: 'POST'
            });
            
            if (!response.ok) throw new Error(await response.text());
            
            const data = await response.json();
            
            if (data.error && !data.metrics) {
                throw new Error(data.error);
            }
            
            state.fileUploaded = true;
            state.auditRun = true;
            state.metricsBefore = data.metrics;
            state.candidateIds = data.candidate_ids;
            state.fullAuditData = data;
            
            // Fetch AI Explanation separately
            fetchAIExplanation(data.metrics, data.feature_importances);

            // Hide upload area, show config as read-only indicator
            els.dropZone.classList.add('hidden');
            els.configArea.classList.remove('hidden');
            els.fileNameDisplay.textContent = 'Sample Dataset (25 rows) — Prototype Mode';
            
            // Populate column dropdowns for display
            els.targetCol.innerHTML = '<option value="hired">hired</option>';
            els.sensitiveCol.innerHTML = '<option value="gender">gender</option>';
            
            // Populate Tab 2: Audit
            updateAuditDashboard(data.metrics);
            
            // Populate Tab 3: Explain
            els.geminiExplanation.innerHTML = `<p>${data.explanation}</p>`;
            els.geminiRootCause.innerHTML = `<p>${data.root_cause}</p>`;
            renderFeatureImportance(data.feature_importances);
            
            // Populate Tab 4: What-If
            els.simCandidateSelect.innerHTML = '';
            data.candidate_ids.forEach(id => {
                els.simCandidateSelect.add(new Option(`Candidate ${id}`, id));
            });
            
            // Enable all nav items
            ['nav-audit', 'nav-explain', 'nav-whatif', 'nav-impact'].forEach(id => {
                document.getElementById(id).classList.remove('disabled');
            });
            
            els.statusBadge.textContent = data.metrics.status === "FAIL" ? "Bias Detected" : "Fairness Passed";
            els.statusBadge.className = `badge status-${data.metrics.status.toLowerCase()}`;
            
            // Save to History
            saveAuditToHistory({
                id: Date.now().toString(),
                date: new Date().toISOString(),
                datasetName: '🧪 Sample Dataset (Prototype)',
                targetCol: 'hired',
                sensitiveCol: 'gender',
                rowCount: 25,
                biasGap: Math.round(data.metrics.demographic_parity_gap * 100),
                status: data.metrics.status
            });
            
            window.location.hash = 'audit';
            
        } catch (err) {
            console.error(err);
            alert("Sample demo failed: " + err.message);
        } finally {
            hideLoader();
        }
    });
}

// --- Tab 2: Audit & Tab 3: Explain ---

els.btnRunAudit.addEventListener('click', async () => {
    if (els.btnRunAudit.disabled) return;
    
    showLoader("Training Model & Detecting Bias...");
    
    const target = els.targetCol.value;
    const sensitive = els.sensitiveCol.value;
    
    try {
        const response = await fetch(`${API_BASE}/audit`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                target_col: target,
                sensitive_col: sensitive,
                threshold: parseFloat(els.biasThreshold.value)
            })
        });
        
        if (!response.ok) throw new Error(await response.text());
        
        const data = await response.json();
        
        state.auditRun = true;
        state.metricsBefore = data.metrics;
        state.candidateIds = data.candidate_ids;
        state.fullAuditData = data;
        
        // Populate Tab 2
        updateAuditDashboard(data.metrics);
        
        // Fetch AI Explanation separately (Task 1)
        fetchAIExplanation(data.metrics, data.feature_importances);
        
        // Populate Tab 4
        els.simCandidateSelect.innerHTML = '';
        data.candidate_ids.forEach(id => {
            els.simCandidateSelect.add(new Option(`Candidate ${id}`, id));
        });
        
        // Enable nav items
        ['nav-explain', 'nav-whatif', 'nav-impact'].forEach(id => {
            document.getElementById(id).classList.remove('disabled');
        });
        
        els.statusBadge.textContent = data.metrics.status === "FAIL" ? "Bias Detected" : "Fairness Passed";
        els.statusBadge.className = `badge status-${data.metrics.status.toLowerCase()}`;
        
        // Save to History
        const activeFile = state.uploadedFiles[state.activeFileIndex];
        saveAuditToHistory({
            id: Date.now().toString(),
            date: new Date().toISOString(),
            datasetName: activeFile ? activeFile.name : 'Unknown',
            targetCol: target,
            sensitiveCol: sensitive,
            rowCount: state.currentRows || 25,
            biasGap: Math.round(data.metrics.demographic_parity_gap * 100),
            status: data.metrics.status,
            auditData: data // Save full data for reload/comparison
        });
        
        window.location.hash = 'audit';
        
    } catch (err) {
        console.error(err);
        alert("Audit failed: " + err.message);
    } finally {
        hideLoader();
    }
});

async function validateCSVConfig() {
    const target = els.targetCol.value;
    const sensitive = els.sensitiveCol.value;
    
    if (!target || !sensitive) {
        els.btnRunAudit.disabled = true;
        return;
    }

    els.validationArea.classList.remove('hidden');
    els.validationList.innerHTML = '<li><div class="loader-inline"></div> Validating data patterns...</li>';
    els.btnRunAudit.disabled = true;

    try {
        const response = await fetch(`${API_BASE}/validate`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                target_col: target,
                sensitive_col: sensitive
            })
        });
        
        const data = await response.json();
        els.validationList.innerHTML = '';
        
        let allPass = true;
        
        data.checks.forEach(check => {
            const li = document.createElement('li');
            li.className = check.pass ? 'pass' : 'fail';
            li.innerHTML = `
                <span class="icon">${check.pass ? '?' : '?'}</span>
                <span class="msg">${check.message}</span>
            `;
            els.validationList.appendChild(li);
            if (!check.pass) allPass = false;
        });

        els.btnRunAudit.disabled = !allPass;
        if (allPass) {
            const li = document.createElement('li');
            li.className = 'pass-all';
            li.innerHTML = '<strong>? Validation Passed.</strong> Model is ready for audit.';
            els.validationList.appendChild(li);
        }

    } catch (err) {
        els.validationList.innerHTML = `<li class="fail">Validation error: ${err.message}</li>`;
    }
}

// Listen for config changes
els.targetCol.addEventListener('change', validateCSVConfig);
els.sensitiveCol.addEventListener('change', validateCSVConfig);

async function fetchAIExplanation(metrics, featureImportances) {
    els.geminiExplanation.innerHTML = '<div class="loader-inline"></div><p>Gemini is analyzing bias patterns...</p>';
    els.geminiRootCause.innerHTML = '<div class="loader-inline"></div><p>Identifying proxy variables...</p>';
    
    try {
        const response = await fetch(`${API_BASE}/explain`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                metrics: metrics,
                feature_importances: featureImportances
            })
        });
        
        if (!response.ok) throw new Error("AI Explanation failed");
        
        const data = await response.json();
        els.geminiExplanation.innerHTML = `<p>${data.explanation}</p>`;
        els.geminiRootCause.innerHTML = `<p>${data.root_cause}</p>`;
        renderFeatureImportance(featureImportances);
        
        // Update stored data if needed
        if (state.fullAuditData) {
            state.fullAuditData.explanation = data.explanation;
            state.fullAuditData.root_cause = data.root_cause;
        }
    } catch (err) {
        console.error(err);
        els.geminiExplanation.innerHTML = '<p class="text-error">AI Explanation unavailable. Please check your connection or API key status.</p>';
        els.geminiRootCause.innerHTML = '<p class="text-error">Could not analyze root cause.</p>';
        renderFeatureImportance(featureImportances);
    }
}

// --- History Storage & Rendering ---
function getHistory() {
    try {
        return JSON.parse(localStorage.getItem('fairhire_history')) || [];
    } catch {
        return [];
    }
}

function saveAuditToHistory(auditRecord) {
    const hist = getHistory();
    hist.unshift(auditRecord); 
    // Keep only last 20 entries to prevent localStorage overflow (5MB limit)
    const limitedHist = hist.slice(0, 20);
    localStorage.setItem('fairhire_history', JSON.stringify(limitedHist));
}

async function renderHistory() {
    if (!els.historyTableBody) return;
    
    els.historyTableBody.innerHTML = '<tr><td colspan="7" style="text-align: center; padding: 2rem;"><div class="loader-inline" style="margin: 0 auto;"></div> Fetching history from database...</td></tr>';
    
    try {
        const response = await fetch(`${API_BASE}/history`);
        const serverHist = await response.json();
        
        // Merge with local history for seamless transition
        const localHist = getHistory();
        let combined = [...serverHist.map(h => ({
            id: h.id,
            date: h.created_at,
            datasetName: h.datasets ? h.datasets.filename : 'Unknown Dataset',
            targetCol: h.metrics.target_col || '—',
            sensitiveCol: h.metrics.sensitive_col || '—',
            rowCount: h.metrics.row_count || '—',
            biasGap: Math.round((h.metrics.demographic_parity_gap || 0) * 100),
            status: h.metrics.status,
            fullData: h
        })), ...localHist];

        // Deduplicate by date/name if needed, but for now just show all
        if (combined.length === 0) {
            els.historyTableBody.innerHTML = '';
            els.noHistoryMsg.style.display = 'block';
            return;
        }
        
        els.noHistoryMsg.style.display = 'none';
        els.historyTableBody.innerHTML = '';
        
        combined.forEach(audit => {
            const d = new Date(audit.date);
            const tr = document.createElement('tr');
            tr.style.borderBottom = "1px solid var(--border-color)";
            tr.innerHTML = `
                <td style="padding: 12px;"><input type="checkbox" class="compare-checkbox" data-id="${audit.id || ''}"></td>
                <td style="padding: 12px; font-size: 0.9rem;">${d.toLocaleDateString()}</td>
                <td style="padding: 12px; font-weight: 500;" title="${audit.datasetName}">${audit.datasetName.substring(0, 20)}${audit.datasetName.length > 20 ? '...' : ''}</td>
                <td style="padding: 12px; font-size: 0.9rem; color: var(--text-muted);">${audit.targetCol} / ${audit.sensitiveCol}</td>
                <td style="padding: 12px; font-size: 0.9rem;">${audit.rowCount}</td>
                <td style="padding: 12px; font-weight: bold;">${audit.biasGap}%</td>
                <td style="padding: 12px;">
                    <button class="btn btn-sm btn-open-audit" data-id="${audit.id || ''}" style="padding: 4px 8px; font-size: 0.75rem;">Open</button>
                </td>
            `;
            els.historyTableBody.appendChild(tr);
        });

        // Add listeners
        document.querySelectorAll('.compare-checkbox').forEach(cb => {
            cb.addEventListener('change', () => updateHistoryComparison(combined));
        });
        document.querySelectorAll('.btn-open-audit').forEach(btn => {
            btn.addEventListener('click', (e) => loadAuditFromHistory(e.target.dataset.id, combined));
        });

    } catch (err) {
        els.historyTableBody.innerHTML = `<tr><td colspan="7" style="color: var(--danger); text-align: center; padding: 1rem;">Failed to load history: ${err.message}</td></tr>`;
    }
}

function updateHistoryComparison() {
    const selected = Array.from(document.querySelectorAll('.compare-checkbox:checked'));
    if (selected.length !== 2) {
        els.historyCompareArea.classList.add('hidden');
        return;
    }

    const hist = getHistory();
    const auditA = hist.find(a => a.id === selected[0].dataset.id);
    const auditB = hist.find(a => a.id === selected[1].dataset.id);

    if (!auditA || !auditB) return;

    els.historyCompareArea.classList.remove('hidden');
    renderComparisonCharts(auditA, auditB);
}

function renderComparisonCharts(a, b) {
    // Bias Score Comparison
    els.compareBiasChart.innerHTML = '';
    [a, b].forEach((audit, i) => {
        const color = i === 0 ? 'var(--primary)' : (audit.biasGap > a.biasGap ? 'var(--destructive)' : 'var(--success)');
        els.compareBiasChart.innerHTML += `
            <div style="display: flex; align-items: center; gap: 8px;">
                <span style="width: 80px; font-size: 0.75rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${audit.datasetName}</span>
                <div style="flex: 1; height: 16px; background: rgba(255,255,255,0.05); border-radius: 4px; overflow: hidden;">
                    <div style="width: ${audit.biasGap}%; height: 100%; background: ${color}; transition: width 0.5s;"></div>
                </div>
                <span style="width: 30px; font-weight: bold;">${audit.biasGap}%</span>
            </div>
        `;
    });

    // Fairness Level Comparison
    const getFairnessVal = (status) => status === 'PASS' ? 3 : 1;
    const getFairnessColor = (status) => status === 'PASS' ? 'var(--success)' : 'var(--destructive)';
    els.compareFairnessChart.innerHTML = '';
    [a, b].forEach(audit => {
        const val = getFairnessVal(audit.status);
        els.compareFairnessChart.innerHTML += `
            <div style="display: flex; align-items: center; gap: 8px;">
                <span style="width: 80px; font-size: 0.75rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${audit.datasetName}</span>
                <div style="flex: 1; height: 16px; background: rgba(255,255,255,0.05); border-radius: 4px; overflow: hidden;">
                    <div style="width: ${(val/3)*100}%; height: 100%; background: ${getFairnessColor(audit.status)}; transition: width 0.5s;"></div>
                </div>
                <span style="width: 50px; font-size: 0.75rem;">${audit.status === 'PASS' ? 'Fair' : 'Biased'}</span>
            </div>
        `;
    });
}

function loadAuditFromHistory(id) {
    const hist = getHistory();
    const entry = hist.find(a => a.id === id);
    if (!entry) return;

    if (!entry.auditData) {
        // Try to recover if it's a sample dataset
        if (entry.datasetName.includes("Sample") || entry.datasetName.includes("Prototype")) {
            showLoader("Recovering legacy sample audit...");
            fetch(`${API_BASE}/audit/sample`, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({
                    target_col: entry.targetCol,
                    sensitive_col: entry.sensitiveCol
                })
            })
            .then(res => res.json())
            .then(data => {
                entry.auditData = data;
                localStorage.setItem('fairhire_history', JSON.stringify(hist));
                hideLoader();
                loadAuditFromHistory(id); // Retry with data
            })
            .catch(err => {
                hideLoader();
                alert("Could not recover legacy entry: " + err.message);
            });
            return;
        }
        
        alert("This is a legacy entry from an uploaded file. Because the original file was not stored, it cannot be re-opened. Please run a new audit.");
        return;
    }

    const data = entry.auditData;
    state.auditRun = true;
    state.metricsBefore = data.metrics;
    state.candidateIds = data.candidate_ids;
    state.fullAuditData = data;
    state.fileUploaded = true;
    state.currentRows = entry.rowCount;

    // Populate all tabs
    updateAuditDashboard(data.metrics);
    
    // Fetch AI Explanation if missing or just to refresh
    fetchAIExplanation(data.metrics, data.feature_importances);
    
    els.simCandidateSelect.innerHTML = '';
    data.candidate_ids.forEach(cid => {
        els.simCandidateSelect.add(new Option(`Candidate ${cid}`, cid));
    });

    // Enable nav
    ['nav-audit', 'nav-explain', 'nav-whatif', 'nav-impact'].forEach(nid => {
        document.getElementById(nid).classList.remove('disabled');
    });

    els.statusBadge.textContent = data.metrics.status === "FAIL" ? "Bias Detected" : "Fairness Passed";
    els.statusBadge.className = `badge status-${data.metrics.status.toLowerCase()}`;
    
    // Smart routing
    const targetHash = data.metrics.status === "FAIL" ? 'audit' : (data.metrics.bias_score > 0.05 ? 'audit' : 'explain');
    window.location.hash = targetHash;
    alert(`Opened audit for ${entry.datasetName} at ${targetHash.toUpperCase()} section.`);
}

// --- Exports (Event Delegation for reliability) ---

document.addEventListener('click', (e) => {
    // JSON Export
    if (e.target.closest('#btn-export-json')) {
        const dataToExport = state.fullAuditData || (state.metricsBefore ? { metrics: state.metricsBefore, metricsAfter: state.metricsAfter } : null);
        
        if (!dataToExport) {
            alert("No audit data available to export. Please run an audit first.");
            return;
        }

        const exportData = {
            generatedAt: new Date().toISOString(),
            dataset: {
                name: state.uploadedFiles[state.activeFileIndex]?.name || 'sample',
                rows: state.currentRows,
                target: els.targetCol.value,
                sensitive: els.sensitiveCol.value
            },
            audit: dataToExport
        };

        const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `fairhire-audit-${exportData.dataset.name.split('.')[0]}-${Date.now()}.json`;
        a.click();
        URL.revokeObjectURL(url);
    }

    // CSV Export
    if (e.target.closest('#btn-export-csv')) {
        if (!state.metricsBefore) {
            alert("No audit metrics available. Please run an audit first.");
            return;
        }
        
        const m = state.metricsBefore;
        const rawName = state.uploadedFiles[state.activeFileIndex]?.name || 'sample';
        const datasetName = `"${rawName.replace(/"/g, '""')}"`; // Escape for CSV
        
        let csv = '\ufeffsection,key,value\n';
        csv += `summary,bias_score,${Math.round(m.demographic_parity_gap * 100)}\n`;
        csv += `summary,status,${m.status}\n`;
        csv += `summary,dataset,${datasetName}\n`;
        csv += `summary,target,${els.targetCol.value}\n`;
        csv += `summary,sensitive,${els.sensitiveCol.value}\n`;
        
        const dpRates = m.demographic_parity ? m.demographic_parity.rates : {};
        Object.entries(dpRates).forEach(([group, rateObj]) => {
            const rate = typeof rateObj === 'object' ? rateObj.rate : rateObj;
            csv += `group_rate,${group},${Math.round(rate * 100)}\n`;
        });
        
        if (state.metricsAfter) {
            csv += `before_after,bias_gap_before,${Math.round(state.metricsBefore.demographic_parity_gap * 100)}\n`;
            csv += `before_after,bias_gap_after,${Math.round(state.metricsAfter.demographic_parity_gap * 100)}\n`;
        }

        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `fairhire-audit-${datasetName.split('.')[0]}-${Date.now()}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    }
});

if (els.btnClearHistory) {
    els.btnClearHistory.addEventListener('click', () => {
        localStorage.removeItem('fairhire_history');
        renderHistory();
    });
}

function animateValue(obj, start, end, duration, formatFn = (x) => x) {
    let startTimestamp = null;
    const step = (timestamp) => {
        if (!startTimestamp) startTimestamp = timestamp;
        const progress = Math.min((timestamp - startTimestamp) / duration, 1);
        obj.innerHTML = formatFn(Math.floor(progress * (end - start) + start));
        if (progress < 1) {
            window.requestAnimationFrame(step);
        }
    };
    window.requestAnimationFrame(step);
}

function updateAuditDashboard(metrics) {
    // Score
    const dp = metrics.demographic_parity;
    const gapPercent = Math.round(dp.gap * 100);
    animateValue(els.biasScoreDisplay, 0, gapPercent, 1000, (v) => `${v}%`);
    
    els.biasStatusDisplay.textContent = metrics.status === "PASS" ? "FAIR OUTCOME" : "BIAS DETECTED";
    els.biasStatusDisplay.className = `bias-status status-${metrics.status.toLowerCase()}`;
    
    // Update Compliance Grid
    updateComplianceCard(els.metricDP, dp, "% Gap");
    updateComplianceCard(els.metricEO, metrics.equal_opportunity, "% Gap");
    updateComplianceCard(els.metricOdds, {gap: metrics.equalized_odds.gap, status: metrics.equalized_odds.status}, "% Gap");
    updateComplianceCard(els.metricEEOC, {gap: metrics.eeoc_rule.ratio, status: metrics.eeoc_rule.status}, " ratio", true);
    
    // Draw chart (may be deferred if tab is hidden)
    drawSelectionChart(metrics);
}

function drawSelectionChart(metrics) {
    const dp = metrics.demographic_parity;
    if (!dp || !dp.rates) return;
    
    els.chartContainer.innerHTML = '<canvas id="selection-chart"></canvas>';
    els.chartContainer.style.minHeight = '250px';
    const canvas = document.getElementById('selection-chart');
    const ctx = canvas.getContext('2d');
    
    // Use container dimensions, fallback to explicit values if tab hidden
    const chartW = els.chartContainer.clientWidth || 500;
    const chartH = Math.max(els.chartContainer.clientHeight, 250);
    canvas.width = chartW;
    canvas.height = chartH;
    
    const groups = Object.keys(dp.rates);
    const rates = Object.values(dp.rates);
    
    const barWidth = 80;
    const spacing = 60;
    const maxH = canvas.height - 40;
    const startX = (canvas.width - (groups.length * barWidth + (groups.length - 1) * spacing)) / 2;
    
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    groups.forEach((group, i) => {
        const rateObj = rates[i];
        const rate = rateObj.rate * 100;
        const h = (rate / 100) * maxH;
        const x = startX + i * (barWidth + spacing);
        const y = canvas.height - 20 - h;
        
        // Bar
        ctx.fillStyle = i === 0 ? '#14b8a6' : '#8ab4f8';
        ctx.beginPath();
        ctx.roundRect(x, y, barWidth, h, [6, 6, 0, 0]);
        ctx.fill();
        
        // Error Bars (CI)
        if (rateObj.ci) {
            const lowY = canvas.height - 20 - (rateObj.ci[0] * maxH);
            const highY = canvas.height - 20 - (rateObj.ci[1] * maxH);
            
            ctx.strokeStyle = 'rgba(255,255,255,0.4)';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(x + barWidth/2, lowY);
            ctx.lineTo(x + barWidth/2, highY);
            ctx.stroke();
            
            // T-caps
            ctx.beginPath();
            ctx.moveTo(x + barWidth/2 - 10, lowY);
            ctx.lineTo(x + barWidth/2 + 10, lowY);
            ctx.moveTo(x + barWidth/2 - 10, highY);
            ctx.lineTo(x + barWidth/2 + 10, highY);
            ctx.stroke();
        }

        // Label Group
        ctx.fillStyle = '#94a3b8';
        ctx.font = '14px Inter';
        ctx.textAlign = 'center';
        ctx.fillText(group, x + barWidth/2, canvas.height - 2);
        
        // Label Value
        ctx.fillStyle = '#f8fafc';
        ctx.font = 'bold 16px Inter';
        ctx.fillText(`${rate.toFixed(1)}%`, x + barWidth/2, y - 10);
    });
}


function updateComplianceCard(el, data, suffix, isRatio = false) {
    if (!el) return;
    const valEl = el.querySelector('.compliance-val');
    const badgeEl = el.querySelector('.badge');
    
    let displayVal = isRatio ? data.gap.toFixed(2) : Math.round(data.gap * 100);
    valEl.textContent = `${displayVal}${suffix}`;
    
    badgeEl.textContent = data.status;
    badgeEl.className = `badge status-${data.status.toLowerCase()}`;
}

function renderFeatureImportance(features) {
    els.featureList.innerHTML = '';
    const maxImp = Math.max(...features.map(f => f.importance));
    
    features.forEach(f => {
        const width = (f.importance / maxImp) * 100;
        const item = document.createElement('div');
        item.className = 'feature-item';
        item.innerHTML = `
            <div class="feature-name">${f.feature}</div>
            <div class="feature-bar-bg">
                <div class="feature-bar-fill" style="width: ${width}%"></div>
            </div>
            <div class="feature-val">${f.importance.toFixed(3)}</div>
        `;
        els.featureList.appendChild(item);
    });
}

// --- Tab 4: What-If Simulator ---

els.btnSimulate.addEventListener('click', async () => {
    const candidateId = els.simCandidateSelect.value;
    const targetGroup = els.simTargetGroup.value || "Male"; // default fallback
    
    if (!candidateId) {
        alert("Please select a candidate first.");
        return;
    }
    
    showLoader("Gemini is simulating outcomes...");
    
    try {
        const response = await fetch(`${API_BASE}/whatif`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                candidate_id: candidateId,
                target_group: targetGroup
            })
        });
        
        if (!response.ok) {
            const errText = await response.text();
            throw new Error(errText);
        }
        
        const data = await response.json();
        
        // Populate profile
        els.simProfileDetails.innerHTML = '';
        Object.entries(data.candidate_data).forEach(([k, v]) => {
            if (['candidate_id', 'hired'].includes(k)) return;
            const li = document.createElement('li');
            li.innerHTML = `<span>${k}</span> <span>${v}</span>`;
            els.simProfileDetails.appendChild(li);
        });
        
        els.simExplanation.innerHTML = `<p>${data.whatif_explanation}</p>`;
        
        if (data.new_probability !== undefined) {
            els.simProbBadge.textContent = `${data.new_probability}% Prob`;
            els.simProbBadge.classList.remove('hidden');
        }
        
        els.simResults.classList.remove('hidden');
        
    } catch (err) {
        console.error(err);
        alert("Simulation failed: " + err.message);
    } finally {
        hideLoader();
    }
});

// --- Tab 5: Mitigation ---

els.btnMitigate.addEventListener('click', async () => {
    showLoader("Applying Reweighting Algorithm...");
    
    try {
        const response = await fetch(`${API_BASE}/mitigate`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                target_col: els.targetCol.value,
                sensitive_col: els.sensitiveCol.value
            })
        });
        
        if (!response.ok) {
            const errText = await response.text();
            throw new Error(errText);
        }
        
        const data = await response.json();
        state.metricsAfter = data.after;
        
        // Populate results
        const gapBefore = Math.round((data.before.demographic_parity ? data.before.demographic_parity.gap : data.before.demographic_parity_gap) * 100);
        const gapAfter = Math.round((data.after.demographic_parity ? data.after.demographic_parity.gap : data.after.demographic_parity_gap) * 100);
        
        els.metricBefore.textContent = `${gapBefore}% Gap`;
        els.metricAfter.textContent = `${gapAfter}% Gap`;
        
        // Update card badges to reflect actual status
        const beforeBadge = els.mitigationResults.querySelector('.metric-card.before .badge');
        const afterBadge = els.mitigationResults.querySelector('.metric-card.after .badge');
        
        if (beforeBadge) {
            beforeBadge.textContent = data.before.status === 'PASS' ? 'Fair' : 'Biased';
            beforeBadge.className = `badge ${data.before.status === 'PASS' ? 'status-pass' : 'status-fail'}`;
        }
        if (afterBadge) {
            afterBadge.textContent = data.after.status === 'PASS' ? 'Fair' : 'Biased';
            afterBadge.className = `badge ${data.after.status === 'PASS' ? 'status-pass' : 'status-fail'}`;
        }
        
        els.mitigationResults.classList.remove('hidden');
        els.statusBadge.textContent = "Fairness Mitigated";
        els.statusBadge.className = "badge status-pass";
        
    } catch (err) {
        console.error(err);
        alert("Mitigation failed: " + err.message);
    } finally {
        hideLoader();
    }
});

// --- Tab 5b: Download PDF Report ---

if (els.btnDownloadPdf) {
    els.btnDownloadPdf.addEventListener('click', async () => {
        // Disable button and show spinner state
        els.btnDownloadPdf.disabled = true;
        els.btnDownloadPdf.setAttribute('aria-busy', 'true');
        els.pdfBtnText.textContent = 'Generating PDF...';

        try {
            // Capture chart as PNG - Add small delay to ensure animations are stable
            let chartPng = null;
            const chartContainer = document.getElementById('selection-chart-container');
            if (window.htmlToImage && chartContainer) {
                // Ensure chart is visible before capture
                await new Promise(r => setTimeout(r, 300)); 
                chartPng = await window.htmlToImage.toPng(chartContainer, { 
                    backgroundColor: '#0f172a',
                    cacheBust: true,
                    pixelRatio: 1.5,
                    fontEmbedCSS: '' // Skip font embedding to avoid CORS/security errors
                });
                
                // Validate PNG signature (simplified)
                if (chartPng && !chartPng.startsWith('data:image/png;base64,iVBORw0KG')) {
                    console.warn("Invalid PNG signature from htmlToImage, skipping chart embed.");
                    chartPng = null;
                }
            }

            // Collect all audit data from state and DOM
            const explanationEl = document.getElementById('gemini-explanation');
            const rootCauseEl = document.getElementById('gemini-root-cause');
            const simExplanationEl = document.getElementById('sim-explanation');
            const featureListEl = document.getElementById('feature-list');

            // Extract text from feature items
            const keyFactors = [];
            if (featureListEl) {
                featureListEl.querySelectorAll('.feature-item').forEach(item => {
                    const name = item.querySelector('.feature-name');
                    const val = item.querySelector('.feature-val');
                    if (name) {
                        keyFactors.push(`${name.textContent}${val ? ' (importance: ' + val.textContent + ')' : ''}`);
                    }
                });
            }

            // Build mitigation narrative
            let mitigationText = '';
            if (state.metricsBefore && state.metricsAfter) {
                const gBefore = Math.round((state.metricsBefore.demographic_parity ? state.metricsBefore.demographic_parity.gap : state.metricsBefore.demographic_parity_gap) * 100);
                const gAfter = Math.round((state.metricsAfter.demographic_parity ? state.metricsAfter.demographic_parity.gap : state.metricsAfter.demographic_parity_gap) * 100);
                mitigationText = `The reweighting algorithm reduced the bias gap from ${gBefore}% to ${gAfter}%. `;
                if (state.metricsAfter.status === 'PASS') {
                    mitigationText += 'The model now meets fairness thresholds and is ready for production deployment with ethical constraints applied.';
                } else {
                    mitigationText += 'The bias has been reduced, but the model may still require additional fairness interventions for full compliance.';
                }
            }

            const audit = {
                metrics: state.metricsBefore,
                before: state.metricsBefore,
                after: state.metricsAfter,
                explanation: explanationEl ? explanationEl.textContent.trim() : '',
                whatIf: simExplanationEl ? simExplanationEl.textContent.trim() : '',
                mitigation: mitigationText,
                keyFactors: keyFactors,
            };

            // Build dataset info
            const activeFile = state.uploadedFiles[state.activeFileIndex];
            const dataset = {
                name: activeFile ? activeFile.name : (els.fileNameDisplay.textContent || 'sample'),
                columns: els.targetCol.options.length || '?',
                targetCol: els.targetCol.value || 'hired',
                sensitiveCol: els.sensitiveCol.value || 'gender',
                rowCountEstimate: state.currentRows || 25
            };

            // Generate and download
            const fileName = generateImpactPdf(audit, dataset, chartPng);
            console.log('PDF downloaded:', fileName);

            // Brief success toast
            els.pdfBtnText.textContent = '✓ PDF Downloaded!';
            setTimeout(() => {
                els.pdfBtnText.textContent = 'Download PDF Report';
            }, 2500);

        } catch (err) {
            console.error('PDF generation failed:', err);
            alert('Could not generate PDF: ' + err.message);
            els.pdfBtnText.textContent = 'Download PDF Report';
        } finally {
            els.btnDownloadPdf.disabled = false;
            els.btnDownloadPdf.removeAttribute('aria-busy');
        }
    });
}
