// ── CLINIC DOCUMENT LETTERHEAD ──────────────────────────────────────────────
// Shared jsPDF layout for every document this clinic prints: the patient
// medical record export (public/customer.js), and the walk-in intake and
// diagnosis forms (public/walkin-forms.js).
//
// It lived inside customer.js while the record export was the only thing that
// printed. It is here now because a clinic's paperwork has to look like one
// clinic's paperwork - a second letterhead written alongside the first is how
// two documents from the same desk end up with different margins, a different
// rule under the masthead and a different confidentiality footer.
//
// The conventions real clinic paperwork uses, and the reason for each piece:
// serif letterhead, a titled document band so a loose sheet identifies itself,
// boxed demographics, ruled section headers, and a repeating footer carrying
// the confidentiality notice and page count.
//
// Requires jspdf (and jspdf-autotable where a caller uses doc.autoTable).

// Appears under the clinic name on the letterhead. Mirrors the landing
// page hero copy — change both together.
const CLINIC_MOTTO = 'Smart Healthcare, At Your Fingertips';

const PDF = {
    margin: 14,
    pageW: 210,          // A4 portrait, millimetres
    pageH: 297,
    brand: [198, 40, 58],       // --primary #C6283A
    ink: [26, 32, 44],          // near-black body text
    muted: [113, 128, 150],     // secondary text
    hairline: [203, 213, 224],  // rules and table borders
    band: [244, 246, 248],      // section header / zebra fill
    headerBottom: 46,           // y where page-1 content may begin
    runningHeaderBottom: 26,    // y where content may begin on pages 2+
    footerTop: 278
};

// jsPDF cannot place an SVG, so the clinic logo is rasterised through a
// canvas first. Returns null on any failure — the letterhead falls back to
// text rather than losing the whole export over a missing image.
async function loadLogoDataUrl(src) {
    try {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        await new Promise((resolve, reject) => {
            img.onload = resolve;
            img.onerror = reject;
            img.src = src;
        });
        const px = 256;
        const canvas = document.createElement('canvas');
        canvas.width = px;
        canvas.height = px;
        canvas.getContext('2d').drawImage(img, 0, 0, px, px);
        return canvas.toDataURL('image/png');
    } catch (err) {
        console.warn('Logo unavailable for PDF letterhead', err);
        return null;
    }
}

// `title` names the document in the band under the letterhead; `marker` is the
// red right-aligned stamp and `markerNote` the line under it. The defaults are
// the patient medical record's, which was the only document this rendered when
// it was written.
function pdfLetterhead(doc, clinic, logo, {
    title = 'Patient Medical Record',
    marker = 'CONFIDENTIAL',
    markerNote = 'Patient Health Information'
} = {}) {
    const { margin, pageW, brand, ink, muted, hairline } = PDF;
    let textX = margin;

    if (logo) {
        doc.addImage(logo, 'PNG', margin, 12, 16, 16);
        textX = margin + 21;
    }

    doc.setTextColor(ink[0], ink[1], ink[2]);
    doc.setFont('times', 'bold');
    doc.setFontSize(19);
    doc.text(clinic.name, textX, 20);

    // System motto — kept in sync with the landing page hero
    // ("Smart Healthcare, At Your Fingertips" in public/index.html).
    // Italic serif pairs with the serif clinic name above it.
    doc.setFont('times', 'italic');
    doc.setFontSize(9.5);
    doc.setTextColor(muted[0], muted[1], muted[2]);
    doc.text(CLINIC_MOTTO, textX, 25.5);

    // Right-aligned marker against the letterhead.
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(brand[0], brand[1], brand[2]);
    doc.text(marker, pageW - margin, 20, { align: 'right' });
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(muted[0], muted[1], muted[2]);
    doc.text(markerNote, pageW - margin, 24.5, { align: 'right' });

    // Accent rule over a hairline — the standard letterhead divider.
    doc.setFillColor(brand[0], brand[1], brand[2]);
    doc.rect(margin, 31, pageW - margin * 2, 1.1, 'F');
    doc.setDrawColor(hairline[0], hairline[1], hairline[2]);
    doc.setLineWidth(0.2);
    doc.line(margin, 32.9, pageW - margin, 32.9);

    // Document title band. Letter-spaced by hand - jsPDF has no tracking
    // control, and the spacing is what makes the band read as a document title
    // rather than a heading.
    doc.setFillColor(PDF.band[0], PDF.band[1], PDF.band[2]);
    doc.rect(margin, 35.5, pageW - margin * 2, 8, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10.5);
    doc.setTextColor(ink[0], ink[1], ink[2]);
    doc.text(spacedTitle(title), pageW / 2, 41, { align: 'center' });
}

// "Intake Form" -> "I N T A K E   F O R M". Kept here so every document in the
// system spaces its title the same way.
function spacedTitle(text) {
    return String(text).toUpperCase().split(' ')
        .map(word => word.split('').join(' '))
        .join('   ');
}

// Compact header for continuation pages, so every sheet is identifiable on
// its own once the document is printed and the pages separated.
function pdfRunningHeader(doc, clinic, patient) {
    const { margin, pageW, muted, hairline } = PDF;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(muted[0], muted[1], muted[2]);
    doc.text(clinic.name.toUpperCase(), margin, 14);
    doc.setFont('helvetica', 'normal');
    doc.text(patient.name + '  ·  ' + patient.id, pageW - margin, 14, { align: 'right' });
    doc.setDrawColor(hairline[0], hairline[1], hairline[2]);
    doc.setLineWidth(0.2);
    doc.line(margin, 17, pageW - margin, 17);
}

function pdfFooter(doc, pageNum, generatedAt) {
    const { margin, pageW, muted, hairline, footerTop } = PDF;
    doc.setDrawColor(hairline[0], hairline[1], hairline[2]);
    doc.setLineWidth(0.2);
    doc.line(margin, footerTop, pageW - margin, footerTop);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.8);
    doc.setTextColor(muted[0], muted[1], muted[2]);
    doc.text('This record contains confidential patient health information. Handle and dispose of it accordingly.', margin, footerTop + 4.5);
    doc.text('Computer-generated document — not a certified true copy. Request a certified copy from the clinic if one is required.', margin, footerTop + 8);
    doc.text('Generated ' + generatedAt, margin, footerTop + 11.5);
}

// Ruled section heading, matching the document band styling.
function pdfSectionHeading(doc, title, y) {
    const { margin, pageW, ink, brand } = PDF;
    doc.setFillColor(PDF.band[0], PDF.band[1], PDF.band[2]);
    doc.rect(margin, y, pageW - margin * 2, 6.5, 'F');
    doc.setFillColor(brand[0], brand[1], brand[2]);
    doc.rect(margin, y, 1.6, 6.5, 'F');   // accent tab on the leading edge
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.8);
    doc.setTextColor(ink[0], ink[1], ink[2]);
    doc.text(title.toUpperCase(), margin + 4, y + 4.4);
    return y + 6.5;
}

// Label/value grid, enclosed in a box with alternating row tints.
//
// Entries are [label, value] (half width, paired two per row) or
// [label, value, 'full'] (its own full-width row). Row height is derived
// from the wrapped line count — long values wrap instead of being clipped,
// which matters most for addresses.
function pdfFieldGrid(doc, entries, startY) {
    const { margin, pageW, ink, muted, hairline } = PDF;
    const usable = pageW - margin * 2;
    const colW = usable / 2;
    const labelH = 3;
    const lineH = 3.9;
    let y = startY;

    // Group entries into visual rows: a 'full' entry claims a row alone,
    // otherwise two half-width entries share one.
    const visualRows = [];
    for (let i = 0; i < entries.length;) {
        const entry = entries[i];
        if (entry[2] === 'full') {
            visualRows.push([entry]);
            i += 1;
        } else {
            const next = entries[i + 1];
            if (next && next[2] !== 'full') { visualRows.push([entry, next]); i += 2; }
            else { visualRows.push([entry]); i += 1; }
        }
    }

    doc.setDrawColor(hairline[0], hairline[1], hairline[2]);
    doc.setLineWidth(0.2);

    visualRows.forEach((cells, rowIndex) => {
        const isFull = cells.length === 1 && cells[0][2] === 'full';
        // Measure first so the row is tall enough for its tallest cell.
        const wrapped = cells.map(cell => {
            const width = (isFull ? usable : colW) - 6;
            return doc.splitTextToSize(String(cell[1] || '—') || '—', width);
        });
        const maxLines = Math.max(1, ...wrapped.map(w => w.length));
        const rowH = labelH + maxLines * lineH + 2.4;

        if (rowIndex % 2 === 0) {
            doc.setFillColor(250, 251, 252);
            doc.rect(margin, y, usable, rowH, 'F');
        }

        cells.forEach((cell, col) => {
            const x = margin + (isFull ? 0 : col * colW);
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(7.4);
            doc.setTextColor(muted[0], muted[1], muted[2]);
            doc.text(String(cell[0]).toUpperCase(), x + 3, y + labelH);
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(9);
            doc.setTextColor(ink[0], ink[1], ink[2]);
            doc.text(wrapped[col], x + 3, y + labelH + 3.2);
        });

        // Column divider only where the row actually has two columns.
        if (!isFull && cells.length === 2) {
            doc.line(margin + colW, y, margin + colW, y + rowH);
        }
        y += rowH;
        if (rowIndex < visualRows.length - 1) doc.line(margin, y, margin + usable, y);
    });

    doc.rect(margin, startY, usable, y - startY);   // enclose the block
    return y;
}

// Free-text block that wraps and reports how far down the page it reached.
function pdfTextBlock(doc, label, text, y) {
    const { margin, pageW, ink, muted } = PDF;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.4);
    doc.setTextColor(muted[0], muted[1], muted[2]);
    doc.text(label.toUpperCase(), margin, y + 3);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.8);
    doc.setTextColor(ink[0], ink[1], ink[2]);
    const lines = doc.splitTextToSize(String(text || 'None reported'), pageW - margin * 2 - 40);
    doc.text(lines, margin + 40, y + 3);
    return y + Math.max(6, lines.length * 4 + 2.5);
}

// ── FILL-IN PRIMITIVES ──────────────────────────────────────────────────────
// A form meant to be completed by hand is a different document from a record
// of something already known: where the record prints an em dash for a value it
// does not have, the form has to print a line to write on. These are the pieces
// that difference needs, and they live here rather than in walkin-forms.js
// because they are document furniture, not walk-in logic.

// Vertical room left on the page before the footer would be overwritten.
const PDF_BOTTOM_GUTTER = 6;

// A page-flowing cursor. Every block asks for the room it needs before drawing,
// so a long form breaks across pages instead of writing over its own footer.
// `onNewPage` stamps whatever the continuation sheets need (a running header).
function pdfFlow(doc, { onNewPage = null } = {}) {
    return {
        doc,
        y: PDF.headerBottom + 3,
        pages: 1,
        // Returns the y to draw at, having moved to a new page first if the
        // block would not fit. A block taller than a whole page (a long ruled
        // section) is clamped rather than looping forever.
        room(needed) {
            const limit = PDF.footerTop - PDF_BOTTOM_GUTTER;
            if (this.y + Math.min(needed, limit - PDF.runningHeaderBottom) > limit) {
                doc.addPage();
                this.pages += 1;
                this.y = PDF.runningHeaderBottom;
                if (onNewPage) onNewPage(doc, this.pages);
            }
            return this.y;
        },
        advance(dy) { this.y += dy; return this.y; },
        gap(dy) { this.y += dy; return this.y; }
    };
}

// The document's headline number, boxed so it is the first thing read. Used for
// the queue number on the walk-in forms: a patient holding this sheet in a
// waiting room has to match it against a board across that room, so it is set
// far larger than anything else on the page.
//
// `fields` are [label, value] pairs printed down the left of the box.
function pdfNumberPanel(doc, { number, numberLabel = 'Queue Number', fields = [] }, y) {
    const { margin, pageW, brand, ink, muted, hairline } = PDF;
    const usable = pageW - margin * 2;
    const panelW = 54;
    const rowH = 5.2;
    const rowStride = rowH + 3.6;    // label, value under it, then the gap
    // Derived from where the last field's value actually lands, not from a
    // guess at the row height: rows advance by rowStride while the first
    // formula counted only rowH, so the third field printed below the box it
    // was supposed to be inside.
    const height = fields.length
        ? Math.max(24, 6 + (fields.length - 1) * rowStride + 4.2 + 3)
        : 24;

    doc.setDrawColor(hairline[0], hairline[1], hairline[2]);
    doc.setLineWidth(0.2);
    doc.rect(margin, y, usable, height);

    // The number gets its own tinted cell, so it reads as a stamp.
    doc.setFillColor(252, 240, 242);
    doc.rect(margin + usable - panelW, y, panelW, height, 'F');
    doc.setDrawColor(hairline[0], hairline[1], hairline[2]);
    doc.line(margin + usable - panelW, y, margin + usable - panelW, y + height);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.8);
    doc.setTextColor(muted[0], muted[1], muted[2]);
    doc.text(String(numberLabel).toUpperCase(), margin + usable - panelW / 2, y + 5.5, { align: 'center' });
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(23);
    doc.setTextColor(brand[0], brand[1], brand[2]);
    doc.text(String(number || '—'), margin + usable - panelW / 2, y + height / 2 + 5.5, { align: 'center' });

    let fy = y + 6;
    fields.forEach(([label, value]) => {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(6.8);
        doc.setTextColor(muted[0], muted[1], muted[2]);
        doc.text(String(label).toUpperCase(), margin + 4, fy);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9.6);
        doc.setTextColor(ink[0], ink[1], ink[2]);
        const text = doc.splitTextToSize(String(value || '—'), usable - panelW - 8)[0];
        doc.text(text, margin + 4, fy + 4.2);
        fy += rowStride;
    });

    return y + height;
}

// Label/value grid where a missing value prints a rule to write on instead of
// an em dash. An entry is [label, value] (half width) or [label, value, 'full']
// for its own row. A value the desk already knows is printed; anything blank
// becomes a line, which is the whole point of handing this to a patient.
function pdfBlankGrid(doc, entries, startY) {
    const { margin, pageW, ink, muted, hairline } = PDF;
    const usable = pageW - margin * 2;
    const colW = usable / 2;
    const rowH = 11;
    let y = startY;

    const visualRows = [];
    for (let i = 0; i < entries.length;) {
        if (entries[i][2] === 'full') { visualRows.push([entries[i]]); i += 1; }
        else {
            const next = entries[i + 1];
            if (next && next[2] !== 'full') { visualRows.push([entries[i], next]); i += 2; }
            else { visualRows.push([entries[i]]); i += 1; }
        }
    }

    doc.setDrawColor(hairline[0], hairline[1], hairline[2]);
    doc.setLineWidth(0.2);

    visualRows.forEach((cells, rowIndex) => {
        const isFull = cells.length === 1 && cells[0][2] === 'full';
        cells.forEach((cell, col) => {
            const x = margin + (isFull ? 0 : col * colW);
            const width = isFull ? usable : colW;
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(7);
            doc.setTextColor(muted[0], muted[1], muted[2]);
            doc.text(String(cell[0]).toUpperCase(), x + 3, y + 4);

            const value = String(cell[1] == null ? '' : cell[1]).trim();
            if (value) {
                doc.setFont('helvetica', 'bold');
                doc.setFontSize(9.2);
                doc.setTextColor(ink[0], ink[1], ink[2]);
                doc.text(doc.splitTextToSize(value, width - 8)[0], x + 3, y + 9);
            } else {
                // The line to write on, inset so it does not touch the cell edge.
                doc.setDrawColor(160, 174, 192);
                doc.setLineWidth(0.25);
                doc.line(x + 3, y + 9.4, x + width - 4, y + 9.4);
                doc.setDrawColor(hairline[0], hairline[1], hairline[2]);
                doc.setLineWidth(0.2);
            }
        });
        if (!isFull && cells.length === 2) doc.line(margin + colW, y, margin + colW, y + rowH);
        y += rowH;
        if (rowIndex < visualRows.length - 1) doc.line(margin, y, margin + usable, y);
    });

    doc.rect(margin, startY, usable, y - startY);
    return y;
}

// How much vertical space a ruled block will take. Callers have to reserve room
// before they draw (pdfFlow.room), and they were guessing at these numbers -
// over-guessing by 5mm was enough to push a one-line "Laboratory remarks" onto
// a sheet of its own, orphaned from the table it belongs to.
function pdfRuledLinesHeight({ lines = 3, label = null, lineGap = 7.4 } = {}) {
    return (label ? 4.5 : 0) + 4 + (lines - 1) * lineGap + 2;
}

// Same, for a checkbox grid.
function pdfCheckboxesHeight(items, { columns = 3, label = null } = {}) {
    return (label ? 5.5 : 0) + Math.ceil(items.length / columns) * 6.2;
}

// Ruled writing space, for anything the form cannot anticipate the shape of - a
// radiologist reading, a clinician finding, a list of allergies.
function pdfRuledLines(doc, y, { lines = 3, label = null, lineGap = 7.4 } = {}) {
    const { margin, pageW, muted } = PDF;
    let top = y;
    if (label) {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(7);
        doc.setTextColor(muted[0], muted[1], muted[2]);
        doc.text(String(label).toUpperCase(), margin, top + 3);
        top += 4.5;
    }
    doc.setDrawColor(190, 200, 212);
    doc.setLineWidth(0.25);
    for (let i = 0; i < lines; i++) {
        const ly = top + 4 + i * lineGap;
        doc.line(margin, ly, pageW - margin, ly);
    }
    return top + 4 + (lines - 1) * lineGap + 2;
}

// Tick-box list, wrapped into columns - what a paper intake form uses for a
// medical history checklist.
function pdfCheckboxes(doc, items, y, { columns = 3, label = null } = {}) {
    const { margin, pageW, ink, muted } = PDF;
    let top = y;
    if (label) {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(7);
        doc.setTextColor(muted[0], muted[1], muted[2]);
        doc.text(String(label).toUpperCase(), margin, top + 3);
        top += 5.5;
    }
    const usable = pageW - margin * 2;
    const colW = usable / columns;
    const box = 3.1;
    const rowH = 6.2;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.2);
    items.forEach((item, i) => {
        const col = i % columns;
        const row = Math.floor(i / columns);
        const x = margin + col * colW;
        const iy = top + row * rowH;
        doc.setDrawColor(120, 134, 152);
        doc.setLineWidth(0.3);
        doc.rect(x, iy, box, box);
        doc.setTextColor(ink[0], ink[1], ink[2]);
        doc.text(doc.splitTextToSize(String(item), colW - box - 5)[0], x + box + 2, iy + box - 0.2);
    });
    const rows = Math.ceil(items.length / columns);
    return top + rows * rowH;
}

// Signature line with a caption under it. `width` lets two sit side by side.
function pdfSignature(doc, y, { label, caption = null, x = null, width = null } = {}) {
    const { margin, pageW, ink, muted } = PDF;
    const usable = pageW - margin * 2;
    const w = width || usable;
    const sx = x == null ? margin : x;
    doc.setDrawColor(90, 104, 122);
    doc.setLineWidth(0.35);
    doc.line(sx, y + 8, sx + w - 6, y + 8);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.4);
    doc.setTextColor(ink[0], ink[1], ink[2]);
    doc.text(String(label).toUpperCase(), sx, y + 12);
    if (caption) {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(6.6);
        doc.setTextColor(muted[0], muted[1], muted[2]);
        doc.text(caption, sx, y + 15.4);
    }
    return y + (caption ? 17 : 13.5);
}

// Page "n of m" in the footer. Deferred to the end of a build, because the
// total is only known once every block has been laid out.
function pdfStampPageNumbers(doc) {
    const total = doc.internal.getNumberOfPages();
    for (let i = 1; i <= total; i++) {
        doc.setPage(i);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(6.8);
        doc.setTextColor(PDF.muted[0], PDF.muted[1], PDF.muted[2]);
        doc.text(`Page ${i} of ${total}`, PDF.pageW - PDF.margin, PDF.footerTop + 11.5, { align: 'right' });
    }
}

// Opens the finished document. Mode 'print' hands it straight to the print
// dialog, which is what a desk with a patient standing at it wants; 'download'
// saves the file. Print falls back to saving when the browser blocks the popup,
// so the desk is never left with nothing at all.
function pdfDeliver(doc, filename, mode = 'print') {
    if (mode === 'download') { doc.save(filename); return 'download'; }
    try {
        doc.autoPrint();
        const win = window.open(doc.output('bloburl'), '_blank');
        if (!win || win.closed) { doc.save(filename); return 'download'; }
        return 'print';
    } catch (err) {
        console.warn('Print handoff failed, saving instead', err);
        doc.save(filename);
        return 'download';
    }
}
