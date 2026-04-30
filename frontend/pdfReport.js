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
    lightBg:      [239, 246, 255], // Soft blue tint for executive summary
    tableBorder:  [226, 232, 240],
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
 * @param {Object} audit  - collected audit data
 * @param {Object} dataset - dataset metadata
 * @param {String} chartPng - (optional) base64 PNG of the selection rate chart
 */
function generateImpactPdf(audit, dataset, chartPng) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'pt', format: 'a4' });

    let y = 0;

    // ── Helper: check page break ─────────────────────────
    function checkBreak(needed) {
        if (y + needed > MAX_Y) {
            doc.addPage();
            y = MARGIN_TOP;
        }
    }

    // ── Helper: draw wrapped paragraph ───────────────────
    function drawParagraph(text, fontSize, color, maxWidth, fontStyle = 'normal') {
        if (!text) return;
        doc.setFontSize(fontSize);
        doc.setTextColor(...color);
        doc.setFont('Helvetica', fontStyle);
        const lineH = fontSize * 1.3;
        const lines = doc.splitTextToSize(text, maxWidth || CONTENT_W);
        for (let i = 0; i < lines.length; i++) {
            checkBreak(lineH);
            doc.text(lines[i], MARGIN_X, y);
            y += lineH;
        }
    }

    // ── Helper: section heading ──────────────────────────
    function drawHeading(text, fontSize = 13, color = PDF_COLORS.foreground) {
        checkBreak(40);
        y += 14;
        doc.setFontSize(fontSize);
        doc.setFont('Helvetica', 'bold');
        doc.setTextColor(...color);
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

    doc.text(`Generated: ${dateStr}`, MARGIN_X, y); y += 14;
    doc.text(`Dataset: ${dataset.name || 'Unknown'} (${dataset.rowCountEstimate || '?'} rows)`, MARGIN_X, y); y += 14;
    doc.text(`Target: ${dataset.targetCol || 'hired'}  \u00B7  Sensitive: ${dataset.sensitiveCol || 'gender'}`, MARGIN_X, y);
    y += 20;

    // ══════════════════════════════════════════════════════
    // 3. HERO STATUS CARD
    // ══════════════════════════════════════════════════════
    const biasGap = audit.metrics ? audit.metrics.demographic_parity_gap : 0;
    const biasPercent = Math.round(biasGap * 100);
    const status = audit.metrics ? audit.metrics.status : 'UNKNOWN';
    const isFail = status === 'FAIL';
    const heroColor = isFail ? PDF_COLORS.biasRed : PDF_COLORS.successGreen;

    doc.setFillColor(...heroColor);
    doc.roundedRect(MARGIN_X, y, CONTENT_W, 64, 8, 8, 'F');

    doc.setFontSize(28); doc.setFont('Helvetica', 'bold'); doc.setTextColor(...PDF_COLORS.white);
    doc.text(`${biasPercent}%`, MARGIN_X + 20, y + 36);
    doc.setFontSize(12); doc.setFont('Helvetica', 'normal');
    doc.text('Bias Score (Gap)', MARGIN_X + 20, y + 52);
    doc.setFontSize(16); doc.setFont('Helvetica', 'bold');
    doc.text(status, PAGE_W - MARGIN_X - 20, y + 40, { align: 'right' });
    y += 80;

    // ══════════════════════════════════════════════════════
    // 4. EXECUTIVE SUMMARY
    // ══════════════════════════════════════════════════════
    doc.setFillColor(...PDF_COLORS.lightBg);
    doc.roundedRect(MARGIN_X, y, CONTENT_W, 90, 4, 4, 'F');
    let summaryY = y + 20;
    doc.setFontSize(14); doc.setFont('Helvetica', 'bold'); doc.setTextColor(...PDF_COLORS.primaryBlue);
    doc.text('Executive Summary', MARGIN_X + 16, summaryY); summaryY += 20;
    
    doc.setFontSize(11); doc.setFont('Helvetica', 'normal'); doc.setTextColor(30, 41, 59);
    const verdict = isFail ? "fails" : "passes";
    const groups = Object.keys(audit.metrics.selection_rates);
    const topGroup = groups[0] || "Group A";
    const bottomGroup = groups[1] || "Group B";
    const summaryText = `This audit reviewed ${dataset.rowCountEstimate} candidates. The model's bias score is ${biasPercent}%, which ${verdict} our 10% fairness threshold. ${topGroup} candidates are selected ${biasPercent}% more often than ${bottomGroup} candidates.`;
    
    const summaryLines = doc.splitTextToSize(summaryText, CONTENT_W - 32);
    doc.text(summaryLines, MARGIN_X + 16, summaryY);
    y += 106;

    // ══════════════════════════════════════════════════════
    // 5. VISUAL EVIDENCE (Embedded Chart)
    // ══════════════════════════════════════════════════════
    if (chartPng) {
        drawHeading('Visual Evidence (Selection Rates)');
        const imgW = CONTENT_W;
        const imgH = 220;
        checkBreak(imgH + 20);
        doc.addImage(chartPng, 'PNG', MARGIN_X, y, imgW, imgH);
        y += imgH + 10;
        doc.setFontSize(9); doc.setTextColor(...PDF_COLORS.footerGray); doc.setFont('Helvetica', 'italic');
        doc.text('Figure 1: Automated selection rate distribution by sensitive group.', PAGE_W / 2, y, { align: 'center' });
        y += 30;
    }

    // ══════════════════════════════════════════════════════
    // 6. BEFORE vs AFTER Table
    // ══════════════════════════════════════════════════════
    if (audit.before && audit.after) {
        drawHeading('Mitigation Impact Analysis');
        const beforeGap = Math.round(audit.before.demographic_parity_gap * 100);
        const afterGap = Math.round(audit.after.demographic_parity_gap * 100);
        doc.autoTable({
            startY: y, margin: { left: MARGIN_X, right: MARGIN_X },
            head: [['Metric', 'Before', 'After']],
            body: [
                ['Bias Gap (%)', `${beforeGap}%`, `${afterGap}%`],
                ['Fairness Status', audit.before.status, audit.after.status],
            ],
            headStyles: { fillColor: PDF_COLORS.primaryBlue, textColor: PDF_COLORS.white, fontStyle: 'bold' },
            columnStyles: { 1: { textColor: PDF_COLORS.biasRed }, 2: { textColor: PDF_COLORS.successGreen } },
            theme: 'grid'
        });
        y = doc.lastAutoTable.finalY + 30;
    }

    // ══════════════════════════════════════════════════════
    // 7. NARRATIVE SECTIONS
    // ══════════════════════════════════════════════════════
    drawHeading('Detailed Analysis');
    if (audit.explanation) {
        drawParagraph("AI Fairness Audit:", 11, PDF_COLORS.foreground, CONTENT_W, 'bold');
        drawParagraph(audit.explanation, 10, PDF_COLORS.muted, CONTENT_W);
        y += 10;
    }
    if (audit.mitigation) {
        drawParagraph("Recommended Mitigation Strategy:", 11, PDF_COLORS.foreground, CONTENT_W, 'bold');
        drawParagraph(audit.mitigation, 10, PDF_COLORS.muted, CONTENT_W);
        y += 10;
    }

    // ══════════════════════════════════════════════════════
    // 8. APPENDIX
    // ══════════════════════════════════════════════════════
    doc.addPage(); y = MARGIN_TOP;
    drawHeading('Appendix A \u2014 Raw Audit Data', 16, PDF_COLORS.primaryBlue);
    
    drawHeading('A.1 Group Selection Rates');
    const groupRows = Object.entries(audit.metrics.selection_rates).map(([g, r]) => [g, `${(r * 100).toFixed(1)}%`, 'N/A']);
    doc.autoTable({
        startY: y, margin: { left: MARGIN_X, right: MARGIN_X },
        head: [['Group', 'Selection Rate (%)', 'Sample Share (%)']],
        body: groupRows,
        headStyles: { fillColor: PDF_COLORS.primaryBlue },
        theme: 'striped'
    });
    y = doc.lastAutoTable.finalY + 20;

    drawHeading('A.2 Key Decision Factors');
    if (audit.keyFactors && audit.keyFactors.length > 0) {
        const factorDescriptions = {
            "employment_gap": "Historical data suggests gaps correlate strongly with rejection rates, potentially penalizing caregivers.",
            "location": "Regional disparities in training data may favor urban candidate profiles over rural ones.",
            "experience_years": "High weighting on years of experience may inadvertently filter out younger demographics."
        };
        audit.keyFactors.forEach((f, i) => {
            const factorName = f.split(' (')[0];
            const desc = factorDescriptions[factorName.toLowerCase()] || "This feature significantly contributed to model predictions and bias encoding.";
            drawParagraph(`${i + 1}. ${f}`, 10, PDF_COLORS.foreground, CONTENT_W, 'bold');
            drawParagraph(desc, 9, PDF_COLORS.muted, CONTENT_W);
            y += 6;
        });
    }

    // ══════════════════════════════════════════════════════
    // 9. FOOTER (Every Page)
    // ══════════════════════════════════════════════════════
    const totalPages = doc.internal.getNumberOfPages();
    for (let i = 1; i <= totalPages; i++) {
        doc.setPage(i);
        doc.setFontSize(9); doc.setTextColor(...PDF_COLORS.footerGray);
        doc.text(`FairHire AI  \u00B7  Page ${i} of ${totalPages}`, PAGE_W / 2, PAGE_H - 20, { align: 'center' });
    }

    const safeName = (dataset.name || 'report').replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 30);
    doc.save(`fairhire-impact-${safeName}-${Date.now()}.pdf`);
}
