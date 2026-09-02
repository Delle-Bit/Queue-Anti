// ── WALK-IN PRINTED FORMS ───────────────────────────────────────────────────
// The two documents a phone-less patient is handed, because the things every
// other patient does on their phone they have to do on paper:
//
//   Intake Form     printed the moment the front desk queues them. Carries the
//                   queue number they will be called by, the service they are
//                   availing, and the medical intake questions a customer
//                   normally answers in the app before choosing a service.
//   Diagnosis Form  printed once they have paid. Carries the route they are
//                   about to walk and the result fields for the service they
//                   actually bought - so each station writes into it as they
//                   go, and the desk transcribes it at the end.
//
// Both are laid out on the shared clinic letterhead (clinic-pdf.js), which is
// also what the patient medical record export prints on. The intake questions
// deliberately use the *same wording and the same options* as the digital
// medical form in customer.html - the checklist below is the req-ch-checkbox
// list, verbatim. That is what makes transcription a copy rather than a
// translation: a tick on paper maps onto exactly one value in current_health.
//
// Requires: jspdf, jspdf-autotable, clinic-pdf.js.

// Verbatim from the .req-ch-checkbox list in customer.html. If that list
// changes, change this one with it - they are the same question asked on two
// different media, and the transcription depends on them agreeing.
const WALKIN_HISTORY_CHECKLIST = [
    'Headaches', 'Cancer', 'Diabetes', 'Blood Clots', 'Arthritis/Tendonitis',
    'Abnormal Skin Condition', 'High/Low Blood Pressure', 'Fibromyalgia',
    'Neck/Back Injury', 'Numbness', 'Varicose Veins', 'Recent Injury',
    'Nursing/Pregnant', 'Depression', 'Fatigue'
];

// The five yes/no questions behind past_conditions (pc-heart, pc-clots, pc-bp,
// pc-chol, pc-surgeries in customer.html), in the same order.
const WALKIN_HISTORY_QUESTIONS = [
    'Heart or circulation problems',
    'Blood clots',
    'High or low blood pressure',
    'High cholesterol',
    'Any previous surgeries'
];

const WALKIN_CONSENT_TEXT =
    'I certify that the information I have given above is true and complete to the best of my knowledge. ' +
    'I consent to the collection and processing of my personal and health information by this clinic for the ' +
    'purpose of my consultation, treatment and records, in accordance with the Data Privacy Act of 2012 ' +
    '(R.A. 10173). I understand that this form will be transcribed into my patient record and that the ' +
    'original may be retained by the clinic.';

function wfDate(value) {
    if (!value) return '';
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString();
}

function wfDateTime(value) {
    if (!value) return '';
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleString();
}

// "PHP 450.00", not "₱450.00". jsPDF's built-in Helvetica is WinAnsi-encoded
// and has no peso glyph, so ₱ came out of the printer as "±450.00" - a wrong
// number-looking character next to a real amount on a document about money.
// Embedding a font that has the glyph would mean shipping a base64 typeface for
// one character; the ISO code is what printed Philippine paperwork uses anyway.
// (formatCurrency in shared.js keeps ₱ - the browser has the glyph.)
function wfPeso(amount) {
    const n = Number(amount);
    if (!Number.isFinite(n)) return '';
    return 'PHP ' + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Branding, fetched the same way the medical record export fetches it: a failed
// settings call must not sink the print, so it falls back to the defaults.
async function wfClinic() {
    let settings = {};
    try {
        const res = await fetch('/api/settings');
        if (res.ok) settings = await res.json();
    } catch (err) {
        console.warn('Clinic branding unavailable for the printed form', err);
    }
    const clinic = {
        name: settings.site_name || 'Medical Clinic',
        logoPath: settings.logo_path || '/images/examplelogo.svg'
    };
    clinic.logo = await loadLogoDataUrl(clinic.logoPath);
    return clinic;
}

// Yes/No tick boxes per question. A paper form cannot use a dropdown, and
// leaving a blank line invites "sometimes" - which does not map onto the Yes/No
// the record actually stores.
function wfYesNoBlock(doc, questions, y, { label = null } = {}) {
    const { margin, pageW, ink, muted } = PDF;
    let top = y;
    if (label) {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(7);
        doc.setTextColor(muted[0], muted[1], muted[2]);
        doc.text(String(label).toUpperCase(), margin, top + 3);
        top += 5.5;
    }
    const rowH = 6.4;
    const box = 3.1;
    const optionsX = pageW - margin - 30;
    questions.forEach((question, i) => {
        const qy = top + i * rowH;
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8.4);
        doc.setTextColor(ink[0], ink[1], ink[2]);
        doc.text(String(question), margin, qy + box - 0.2);

        doc.setDrawColor(120, 134, 152);
        doc.setLineWidth(0.3);
        doc.rect(optionsX, qy, box, box);
        doc.setFontSize(7.6);
        doc.text('Yes', optionsX + box + 1.6, qy + box - 0.2);
        doc.rect(optionsX + 14, qy, box, box);
        doc.text('No', optionsX + 14 + box + 1.6, qy + box - 0.2);
    });
    return top + questions.length * rowH;
}

// ── INTAKE FORM ─────────────────────────────────────────────────────────────
function wfBuildIntakeForm(data, clinic) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    const p = data.patient || {};
    const service = data.service || {};

    pdfLetterhead(doc, clinic, clinic.logo, {
        title: 'Patient Intake Form',
        marker: 'WALK-IN INTAKE',
        markerNote: 'Complete and hand back to the front desk'
    });

    const flow = pdfFlow(doc, {
        onNewPage: (d) => pdfRunningHeader(d, clinic, { name: p.name || 'Walk-in patient', id: data.ticket || '' })
    });

    // The queue number first and largest. This sheet is what the patient holds
    // while watching the lobby board, and it is the only place they can read
    // their number from - they have no phone to check it on.
    flow.y = pdfNumberPanel(doc, {
        number: data.ticket,
        numberLabel: 'Queue Number',
        fields: [
            // The walk-in-exclusive field: an online customer picks their service
            // in the app and never needs it printed. Here it is the only record
            // of what they are queued for until the desk transcribes this sheet.
            ['Service Availed', service.name],
            ['Registered At', wfDateTime(data.started_at)],
            ['Priority Category', p.category || 'Regular']
        ]
    }, flow.room(34));

    flow.gap(4);
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(7.8);
    doc.setTextColor(PDF.muted[0], PDF.muted[1], PDF.muted[2]);
    doc.text(
        'Please complete every blank field below in block letters, sign at the bottom, and return this sheet to the front desk.',
        PDF.margin, flow.room(6) + 3);
    flow.advance(7);

    flow.y = pdfSectionHeading(doc, 'Patient Information', flow.room(34)) + 1.5;
    flow.y = pdfBlankGrid(doc, [
        ['Patient Name', p.name],
        ['Patient ID', p.uid],
        ['Date of Birth', wfDate(p.birthday)],
        ['Age', p.age == null ? '' : String(p.age)],
        ['Sex', p.gender],
        ['Priority Category', p.category],
        ['Civil Status', p.civil_status],
        ['Occupation', p.occupation],
        ['Place of Birth', p.birthplace],
        ['Contact Number', p.phone],
        ['Complete Address', p.address, 'full'],
        ['Emergency Contact — Name and Number', p.emergency_contact, 'full']
    ], flow.y);

    flow.gap(6);
    flow.y = pdfSectionHeading(doc, 'Medical History', flow.room(46)) + 2;
    const checklistOpts = {
        columns: 3,
        label: 'Tick anything that applies to you now or has in the past'
    };
    flow.y = pdfCheckboxes(doc, WALKIN_HISTORY_CHECKLIST,
        flow.room(pdfCheckboxesHeight(WALKIN_HISTORY_CHECKLIST, checklistOpts)), checklistOpts);
    flow.gap(4);
    flow.y = wfYesNoBlock(doc, WALKIN_HISTORY_QUESTIONS, flow.room(40), {
        label: 'Have you ever been told you have, or been treated for'
    });
    flow.gap(3);
    const surgeryOpts = { lines: 1, label: 'If you answered yes to previous surgeries, please give details' };
    flow.y = pdfRuledLines(doc, flow.room(pdfRuledLinesHeight(surgeryOpts)), surgeryOpts);

    flow.gap(5);
    flow.y = pdfSectionHeading(doc, 'Reason for Today’s Visit', flow.room(40)) + 2;
    flow.y = pdfRuledLines(doc, flow.y, { lines: 3, label: 'Current symptoms or concern' });
    flow.gap(3);
    const allergyOpts = { lines: 1, label: 'Known allergies' };
    flow.y = pdfRuledLines(doc, flow.room(pdfRuledLinesHeight(allergyOpts)), allergyOpts);
    flow.gap(2);
    const medsOpts = { lines: 1, label: 'Medicines you are currently taking' };
    flow.y = pdfRuledLines(doc, flow.room(pdfRuledLinesHeight(medsOpts)), medsOpts);

    flow.gap(6);
    flow.y = pdfSectionHeading(doc, 'Declaration and Data Privacy Consent', flow.room(48)) + 2;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.6);
    doc.setTextColor(PDF.ink[0], PDF.ink[1], PDF.ink[2]);
    const consent = doc.splitTextToSize(WALKIN_CONSENT_TEXT, PDF.pageW - PDF.margin * 2);
    doc.text(consent, PDF.margin, flow.y + 3);
    flow.advance(consent.length * 3.4 + 6);

    const halfW = (PDF.pageW - PDF.margin * 2) / 2;
    const sigY = flow.room(20);
    pdfSignature(doc, sigY, {
        label: 'Signature of patient', caption: 'Printed name and signature',
        x: PDF.margin, width: halfW
    });
    flow.y = pdfSignature(doc, sigY, {
        label: 'Date signed', caption: 'Or signature of parent / guardian if a minor',
        x: PDF.margin + halfW, width: halfW
    });

    flow.gap(5);
    const officeY = flow.room(18);
    doc.setDrawColor(PDF.hairline[0], PDF.hairline[1], PDF.hairline[2]);
    doc.setLineWidth(0.2);
    doc.rect(PDF.margin, officeY, PDF.pageW - PDF.margin * 2, 14);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.8);
    doc.setTextColor(PDF.muted[0], PDF.muted[1], PDF.muted[2]);
    doc.text('FOR OFFICE USE ONLY', PDF.margin + 3, officeY + 4);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.4);
    doc.text('Transcribed into the patient record by ______________________________     Date ____________________     Ref '
        + (p.uid || '') + '   ·   Queue ' + (data.ticket || ''), PDF.margin + 3, officeY + 10);
    flow.advance(16);

    return doc;
}

// ── DIAGNOSIS FORM ──────────────────────────────────────────────────────────
// Printed after payment, and shaped by the service the patient actually paid
// for: the station route becomes the sign-off table, and the service's own
// result form becomes the results section - a structured panel prints its
// parameters with units and reference ranges to write into, a freeform one
// prints ruled space for a written report. That is what makes this a template
// per service rather than one form for everything.
function wfBuildDiagnosisForm(data, clinic) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    const p = data.patient || {};
    const service = data.service || {};
    const steps = data.steps || [];
    const structure = data.test_structure || null;

    pdfLetterhead(doc, clinic, clinic.logo, {
        title: 'Diagnosis and Results Form',
        marker: 'CONFIDENTIAL',
        markerNote: 'Patient Health Information'
    });

    const flow = pdfFlow(doc, {
        onNewPage: (d) => pdfRunningHeader(d, clinic, { name: p.name || 'Patient', id: data.ticket || p.uid || '' })
    });

    flow.y = pdfNumberPanel(doc, {
        number: data.ticket,
        numberLabel: 'Queue Number',
        fields: [
            ['Service Availed', service.name],
            ['Patient', [p.name, p.uid].filter(Boolean).join('  ·  ')],
            ['Payment', data.paid
                ? `Settled ${wfDateTime(data.paid_at)}  ·  ${wfPeso(service.price)}`
                : 'Not yet settled']
        ]
    }, flow.room(34));

    flow.gap(5);
    // The panel above already carries the patient's name, id and the amount, so
    // this grid says what it does not: two rows instead of three, and a sheet
    // that no longer restates itself twice in the first third of the page.
    flow.y = pdfSectionHeading(doc, 'Patient Details', flow.room(28)) + 1.5;
    flow.y = pdfFieldGrid(doc, [
        ['Age / Sex', [p.age == null ? null : p.age + ' yrs', p.gender].filter(Boolean).join(' / ')],
        ['Priority Category', p.category],
        ['Service Category', service.category],
        ['Date of Visit', wfDate(data.started_at)]
    ], flow.y);

    // ── The route, as a sign-off table ──────────────────────────────────
    flow.gap(6);
    flow.y = pdfSectionHeading(doc, 'Visit Route', flow.room(40)) + 1;
    doc.autoTable({
        startY: flow.y + 1,
        head: [['#', 'Station', 'Time In', 'Time Out', 'Attended By']],
        body: steps.map(step => [
            String(step.index + 1),
            step.name + (step.is_final ? '  (final — closes the visit)' : ''),
            '', '', ''
        ]),
        theme: 'grid',
        margin: { left: PDF.margin, right: PDF.margin, top: PDF.runningHeaderBottom, bottom: 26 },
        styles: {
            font: 'helvetica', fontSize: 8, cellPadding: 2.6,
            textColor: PDF.ink, lineColor: PDF.hairline, lineWidth: 0.15,
            valign: 'middle', minCellHeight: 8
        },
        headStyles: {
            fillColor: PDF.brand, textColor: [255, 255, 255],
            fontSize: 7.4, fontStyle: 'bold', halign: 'left'
        },
        alternateRowStyles: { fillColor: [250, 251, 252] },
        columnStyles: {
            0: { cellWidth: 9, halign: 'center' },
            1: { cellWidth: 'auto' },
            2: { cellWidth: 26 },
            3: { cellWidth: 26 },
            4: { cellWidth: 36 }
        },
        didDrawPage: () => {
            const page = doc.internal.getCurrentPageInfo().pageNumber;
            if (page > 1) pdfRunningHeader(doc, clinic, { name: p.name || 'Patient', id: data.ticket || '' });
        }
    });
    flow.y = doc.lastAutoTable.finalY;
    // autoTable paginates on its own, so the flow cursor has to be told which
    // page it is on now - otherwise the next block asks for room on the wrong
    // one and writes over the table.
    flow.pages = doc.internal.getNumberOfPages();

    // ── Results, shaped by the service's own result form ────────────────
    flow.gap(6);
    const resultsTitle = structure ? `Results — ${structure.name}` : 'Results';
    flow.y = pdfSectionHeading(doc, resultsTitle, flow.room(50)) + 2;

    // Anything already recorded for this visit, so a reprint later carries the
    // values instead of coming out blank a second time.
    const recorded = {};
    let freeformNotes = [];
    (data.results || []).forEach(record => {
        let payload = record.data;
        if (typeof payload === 'string') {
            try { payload = JSON.parse(payload); } catch (e) { payload = null; }
        }
        if (payload && payload.parameters) {
            Object.entries(payload.parameters).forEach(([key, value]) => { recorded[key] = value; });
        }
        if (record.notes) freeformNotes.push(record.notes);
    });

    if (structure && structure.input_mode === 'structured' && (structure.fields || []).length) {
        doc.autoTable({
            startY: flow.y,
            head: [['Parameter', 'Result', 'Unit', 'Reference Range']],
            body: structure.fields.map(field => [
                field.label,
                recorded[field.label] != null ? String(recorded[field.label]) : '',
                field.unit || '',
                field.reference_range || ''
            ]),
            theme: 'grid',
            margin: { left: PDF.margin, right: PDF.margin, top: PDF.runningHeaderBottom, bottom: 26 },
            styles: {
                font: 'helvetica', fontSize: 8.2, cellPadding: 2.8,
                textColor: PDF.ink, lineColor: PDF.hairline, lineWidth: 0.15,
                valign: 'middle', minCellHeight: 9
            },
            headStyles: {
                fillColor: PDF.brand, textColor: [255, 255, 255],
                fontSize: 7.4, fontStyle: 'bold', halign: 'left'
            },
            alternateRowStyles: { fillColor: [250, 251, 252] },
            columnStyles: {
                0: { cellWidth: 'auto', fontStyle: 'bold' },
                1: { cellWidth: 38 },
                2: { cellWidth: 24, textColor: PDF.muted },
                3: { cellWidth: 40, textColor: PDF.muted }
            },
            didDrawPage: () => {
                const page = doc.internal.getCurrentPageInfo().pageNumber;
                if (page > 1) pdfRunningHeader(doc, clinic, { name: p.name || 'Patient', id: data.ticket || '' });
            }
        });
        flow.y = doc.lastAutoTable.finalY;
        flow.pages = doc.internal.getNumberOfPages();
        flow.gap(3);
        const remarkOpts = { lines: 1, label: 'Laboratory remarks' };
        flow.y = pdfRuledLines(doc, flow.room(pdfRuledLinesHeight(remarkOpts)), remarkOpts);
    } else {
        // A freeform result form has no fields by design - "Other Diagnostics"
        // and the imaging reads are written up as a report, so what the sheet
        // owes them is ruled space, not empty parameter rows.
        const reportOpts = {
            lines: 7,
            label: structure ? `${structure.name} — findings and report` : 'Findings and report'
        };
        flow.y = pdfRuledLines(doc, flow.room(pdfRuledLinesHeight(reportOpts)), reportOpts);
        if (freeformNotes.length) {
            flow.gap(3);
            flow.y = pdfTextBlock(doc, 'On file', freeformNotes.join('  |  '), flow.room(14));
        }
    }

    // ── The clinician's part, only if the route has one ─────────────────
    const hasDoctor = steps.some(step => step.type === 'doctor');
    if (hasDoctor) {
        flow.gap(6);
        const assessOpts = { lines: 4, label: 'Assessment and diagnosis' };
        const planOpts = { lines: 3, label: 'Prescription and plan' };
        // The heading, both ruled blocks and the signature under them are one
        // thing: a diagnosis section split across a page break leaves a
        // clinician signing a sheet with no findings on it.
        flow.y = pdfSectionHeading(doc, 'Clinical Findings and Diagnosis', flow.room(
            8 + pdfRuledLinesHeight(assessOpts) + 3 + pdfRuledLinesHeight(planOpts) + 24)) + 2;
        flow.y = pdfRuledLines(doc, flow.y, assessOpts);
        flow.gap(3);
        flow.y = pdfRuledLines(doc, flow.y, planOpts);
        flow.gap(4);
        flow.y = pdfSignature(doc, flow.room(20), {
            label: 'Attending physician',
            caption: data.doctor
                ? `${data.doctor.name}${data.doctor.specialty ? ' — ' + data.doctor.specialty : ''}   ·   Licence no. ____________________`
                : 'Name, signature and licence number'
        });
    }

    flow.gap(5);
    flow.y = pdfSignature(doc, flow.room(20), {
        label: 'Received by patient',
        caption: 'Signature and date, on release of results at the front desk'
    });

    return doc;
}

// ── ENTRY POINT ─────────────────────────────────────────────────────────────
// `kind` is 'intake' or 'diagnosis'; `mode` is 'print' (straight to the print
// dialog) or 'download'.
async function printWalkInForm(sequenceId, kind, mode = 'print') {
    if (typeof window.jspdf === 'undefined') {
        showToast('The PDF library did not load — check the connection and reload.', 'error');
        return false;
    }
    try {
        const res = await fetch(`/api/walkin/${sequenceId}/forms`, { headers: authHeaders() });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            showToast(data.error || 'Could not load this patient’s form.', 'error');
            return false;
        }

        const clinic = await wfClinic();
        const doc = kind === 'diagnosis'
            ? wfBuildDiagnosisForm(data, clinic)
            : wfBuildIntakeForm(data, clinic);

        // Footers last: every page needs one, including the pages autoTable
        // added while it was paginating a long route.
        const generatedAt = new Date().toLocaleString();
        const total = doc.internal.getNumberOfPages();
        for (let i = 1; i <= total; i++) {
            doc.setPage(i);
            pdfFooter(doc, i, generatedAt);
        }
        pdfStampPageNumbers(doc);

        const slug = String(data.patient && data.patient.name || 'patient')
            .replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();
        const name = `${kind === 'diagnosis' ? 'diagnosis-form' : 'intake-form'}-${data.ticket || sequenceId}-${slug}.pdf`;

        const delivered = pdfDeliver(doc, name, mode);
        showToast(delivered === 'print'
            ? `${kind === 'diagnosis' ? 'Diagnosis' : 'Intake'} form sent to the printer`
            : `${kind === 'diagnosis' ? 'Diagnosis' : 'Intake'} form downloaded`, 'success');
        return true;
    } catch (err) {
        console.error('Walk-in form print error:', err);
        showToast('Failed to generate the form.', 'error');
        return false;
    }
}
