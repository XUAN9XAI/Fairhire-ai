/**
 * FairHire AI — Client-side Impact Report PDF Generator
 * Uses jspdf + jspdf-autotable (loaded via CDN)
 * No network calls — fully offline generation
 */

// ── Color palette (RGB) ──────────────────────────────────
const PDF_COLORS = {
    primaryBlue:  [37, 99, 235],
    successGreen: [22, 163, 74],
    biasRed:      [220, 38, 38],
    warningYellow:[245, 158, 11],
    foreground:   [15, 23, 42],
    muted:        [60, 70, 90],
    footerGray:   [140, 150, 165],
    white:        [255, 255, 255],
    lightBg:      [245, 247, 250],
    tableBorder:  [220, 225, 235],
};

// ── Layout constants ─────────────────────────────────────
const MARGIN_X   = 48;
const MARGIN_TOP = 60;
const PAGE_W     = 595.28; // A4 points width
const PAGE_H     = 841.89; // A4 points height
const CONTENT_W  = PAGE_W - 2 * MARGIN_X;
const MAX_Y      = 720;    // page break threshold

/**
 * Main export: generates and downloads the impact report PDF.
 * @param {Object} audit  - collected audit data (see buildAuditData in app.js)
 * @param {Object} dataset - { name, columns, targetCol, sensitiveCol }
 */
function generateImpactPdf(audit, dataset) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'pt', format: 'a4' });

    let y = 0;
    let pageCount = 1;

    // ── Helper: check page break ─────────────────────────
    function checkBreak(needed) {
        if (y + needed > MAX_Y) {
            doc.addPage();
            pageCount++;
            y = MARGIN_TOP;
        }
    }

    // ── Helper: draw wrapped paragraph ───────────────────
    function drawParagraph(text, fontSize, color, maxWidth) {
        if (!text) return;
        doc.setFontSize(fontSize);
        doc.setTextColor(...color);
        doc.setFont('Helvetica', 'normal');
        const lineH = fontSize * 1.3;
        const lines = doc.splitTextToSize(text, maxWidth || CONTENT_W);
        for (let i = 0; i < lines.length; i++) {
            checkBreak(lineH);
            doc.text(lines[i], MARGIN_X, y);
            y += lineH;
        }
    }

    // ── Helper: section heading ──────────────────────────
    function drawHeading(text) {
        checkBreak(30);
        y += 14;
        doc.setFontSize(13);
        doc.setFont('Helvetica', 'bold');
        doc.setTextColor(...PDF_COLORS.foreground);
        doc.text(text, MARGIN_X, y);
        y += 18;
    }

    // ══════════════════════════════════════════════════════
    // 1. HEADER BAND
    // ══════════════════════════════════════════════════════
    doc.setFillColor(...PDF_COLORS.primaryBlue);
    doc.rect(0, 0, PAGE_W, 70, 'F');
    doc.setFontSize(20);
    doc.setFont('Helvetica', 'bold');
    doc.setTextColor(...PDF_COLORS.white);
    doc.text('FairHire AI \u2014 Impact Report', MARGIN_X, 44);
    y = 90;

    // ══════════════════════════════════════════════════════
    // 2. METADATA BLOCK
    // ══════════════════════════════════════════════════════
    doc.setFontSize(10);
    doc.setFont('Helvetica', 'normal');
    doc.setTextColor(...PDF_COLORS.foreground);

    const now = new Date();
    const dateStr = now.toLocaleDateString() + ' ' + now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    const metaLines = [
        `Generated: ${dateStr}`,
        `Dataset: ${dataset.name || 'Unknown'} (${dataset.columns || '?'} columns)`,
        `Target: ${dataset.targetCol || 'hired'}  \u00B7  Sensitive: ${dataset.sensitiveCol || 'gender'}`,
    ];
    metaLines.forEach(line => {
        doc.text(line, MARGIN_X, y);
        y += 14;
    });
    y += 6;

    // ══════════════════════════════════════════════════════
    // 3. HERO STATUS CARD
    // ══════════════════════════════════════════════════════
    const biasGap = audit.metrics ? audit.metrics.demographic_parity_gap : 0;
    const biasPercent = Math.round(biasGap * 100);
    const status = audit.metrics ? audit.metrics.status : 'UNKNOWN';
    const isFail = status === 'FAIL';
    const heroColor = isFail ? PDF_COLORS.biasRed : PDF_COLORS.successGreen;

    // Rounded rect background
    doc.setFillColor(...heroColor);
    doc.roundedRect(MARGIN_X, y, CONTENT_W, 64, 8, 8, 'F');

    // Left: bias score
    doc.setFontSize(28);
    doc.setFont('Helvetica', 'bold');
    doc.setTextColor(...PDF_COLORS.white);
    doc.text(`${biasPercent}%`, MARGIN_X + 20, y + 36);

    doc.setFontSize(12);
    doc.setFont('Helvetica', 'normal');
    doc.text('Bias Score (gap between groups)', MARGIN_X + 20, y + 52);

    // Right: PASS/FAIL
    doc.setFontSize(16);
    doc.setFont('Helvetica', 'bold');
    doc.text(status, PAGE_W - MARGIN_X - 20, y + 40, { align: 'right' });

    y += 80;

    // ══════════════════════════════════════════════════════
    // 4. GROUP SELECTION RATES TABLE
    // ══════════════════════════════════════════════════════
    drawHeading('Group Selection Rates');

    const selectionRates = audit.metrics ? audit.metrics.selection_rates : {};
    const groupRows = Object.entries(selectionRates).map(([group, rate]) => [
        group,
        `${(rate * 100).toFixed(1)}%`
    ]);

    if (groupRows.length > 0) {
        doc.autoTable({
            startY: y,
            margin: { left: MARGIN_X, right: MARGIN_X },
            head: [['Group', 'Selection Rate']],
            body: groupRows,
            headStyles: {
                fillColor: PDF_COLORS.primaryBlue,
                textColor: PDF_COLORS.white,
                fontStyle: 'bold',
                fontSize: 10,
                halign: 'left',
            },
            bodyStyles: {
                fontSize: 10,
                textColor: PDF_COLORS.foreground,
                cellPadding: 8,
            },
            alternateRowStyles: {},
            tableLineWidth: 0.5,
            tableLineColor: PDF_COLORS.tableBorder,
            theme: 'grid',
        });
        y = doc.lastAutoTable.finalY + 16;
    }

    // ══════════════════════════════════════════════════════
    // 5. BEFORE vs AFTER MITIGATION TABLE
    // ══════════════════════════════════════════════════════
    if (audit.before && audit.after) {
        drawHeading('Before vs After Mitigation');

        const beforeGap = Math.round(audit.before.demographic_parity_gap * 100);
        const afterGap = Math.round(audit.after.demographic_parity_gap * 100);
        const beforeFairness = audit.before.status === 'PASS' ? 'Fair' : 'Biased';
        const afterFairness = audit.after.status === 'PASS' ? 'Fair' : 'Biased';

        doc.autoTable({
            startY: y,
            margin: { left: MARGIN_X, right: MARGIN_X },
            head: [['Metric', 'Before', 'After']],
            body: [
                ['Bias Gap', `${beforeGap}%`, `${afterGap}%`],
                ['Fairness', beforeFairness, afterFairness],
            ],
            headStyles: {
                fillColor: PDF_COLORS.primaryBlue,
                textColor: PDF_COLORS.white,
                fontStyle: 'bold',
                fontSize: 10,
                halign: 'left',
            },
            bodyStyles: {
                fontSize: 10,
                textColor: PDF_COLORS.foreground,
                cellPadding: 8,
            },
            columnStyles: {
                1: { textColor: PDF_COLORS.biasRed, fontStyle: 'bold' },
                2: { textColor: PDF_COLORS.successGreen, fontStyle: 'bold' },
            },
            theme: 'grid',
            tableLineWidth: 0.5,
            tableLineColor: PDF_COLORS.tableBorder,
        });
        y = doc.lastAutoTable.finalY + 16;
    }

    // ══════════════════════════════════════════════════════
    // 6. NARRATIVE SECTIONS
    // ══════════════════════════════════════════════════════

    // 6a. AI Explanation
    if (audit.explanation) {
        drawHeading('AI Explanation');
        drawParagraph(audit.explanation, 10, PDF_COLORS.muted, CONTENT_W);
        y += 8;
    }

    // 6b. What-If Simulation
    if (audit.whatIf) {
        drawHeading('What-If Simulation');
        drawParagraph(audit.whatIf, 10, PDF_COLORS.muted, CONTENT_W);
        y += 8;
    }

    // 6c. Recommended Mitigation
    if (audit.mitigation) {
        drawHeading('Recommended Mitigation');
        drawParagraph(audit.mitigation, 10, PDF_COLORS.muted, CONTENT_W);
        y += 8;
    }

    // ══════════════════════════════════════════════════════
    // 7. KEY FACTORS (bulleted list)
    // ══════════════════════════════════════════════════════
    if (audit.keyFactors && audit.keyFactors.length > 0) {
        drawHeading('Key Factors');

        doc.setFontSize(10);
        doc.setFont('Helvetica', 'normal');
        doc.setTextColor(...PDF_COLORS.muted);

        audit.keyFactors.forEach(factor => {
            checkBreak(15);
            doc.text(`\u2022  ${factor}`, MARGIN_X + 8, y);
            y += 14;
        });
        y += 8;
    }

    // ══════════════════════════════════════════════════════
    // 8. FOOTER (every page)
    // ══════════════════════════════════════════════════════
    const totalPages = doc.internal.getNumberOfPages();
    for (let i = 1; i <= totalPages; i++) {
        doc.setPage(i);
        doc.setFontSize(9);
        doc.setFont('Helvetica', 'normal');
        doc.setTextColor(...PDF_COLORS.footerGray);
        doc.text(
            `FairHire AI  \u00B7  Page ${i} of ${totalPages}`,
            PAGE_W / 2,
            PAGE_H - 20,
            { align: 'center' }
        );
    }

    // ══════════════════════════════════════════════════════
    // SAVE
    // ══════════════════════════════════════════════════════
    const safeName = (dataset.name || 'report')
        .replace(/[^a-zA-Z0-9_-]/g, '_')
        .replace(/_+/g, '_')
        .substring(0, 40);
    const fileName = `fairhire-impact-${safeName}-${Date.now()}.pdf`;

    doc.save(fileName);
    return fileName;
}
