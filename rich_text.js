// Sanitising for the "Other Diagnostics" notepad.
//
// The laboratory's freeform result is HTML: staff type into a contenteditable
// box, and what they write is rendered back to the patient on their medical
// history page and into the exported record. That makes it the one place in
// this system where one user's input is shown to another as markup rather than
// as text, so it is sanitised here, on write, in the server.
//
// The browser sanitises too (sanitizeRichHtml in public/shared.js), but that is
// a convenience for the person typing - a client check is not a boundary, and
// this module is the boundary.
//
// The approach is a strict allow-list: an allowed tag is re-emitted with every
// attribute dropped, and anything else is removed while its text is kept. No
// attribute survives, so there is no href, no style, no event handler and no
// src to reason about. That is deliberately blunter than a general-purpose
// sanitiser and it is the right trade here - this box holds clinical prose, not
// layout.
//
// Tag-level regexes are safe against this input because the source is a
// contenteditable field, which escapes a typed "<" to &lt; before it ever
// reaches us. Anything hand-crafted that slips a stray "<" through degrades to
// text, not to markup.

const ALLOWED_TAGS = new Set([
    'p', 'br', 'div',
    'b', 'strong', 'i', 'em', 'u',
    'ul', 'ol', 'li',
    'h3', 'h4',
    'blockquote'
]);

// A clinical note that runs past this is a sign something is wrong - a paste of
// a whole document, or a loop. The column behind it is JSON, so the cap is
// about sanity rather than storage.
const MAX_RICH_TEXT_LENGTH = 20000;

// Elements whose *content* must go with them. Stripping only the tags of a
// <script> block would leave the code sitting in the record as visible text.
const DROP_WITH_CONTENT = /<(script|style|iframe|object|embed|template|noscript)\b[\s\S]*?<\/\1\s*>/gi;

function sanitizeRichText(input) {
    if (input == null) return '';
    let html = String(input);

    html = html.replace(DROP_WITH_CONTENT, '');
    // An unclosed <script ...> would survive the pair-matching pass above.
    html = html.replace(/<\/?(script|style|iframe|object|embed|template|noscript)\b[^>]*>/gi, '');
    html = html.replace(/<!--[\s\S]*?-->/g, '');

    html = html.replace(/<\/?([a-zA-Z][a-zA-Z0-9-]*)\b[^>]*>/g, (tag, rawName) => {
        const name = rawName.toLowerCase();
        if (!ALLOWED_TAGS.has(name)) return '';
        const closing = /^<\//.test(tag);
        if (name === 'br') return '<br>';
        return closing ? `</${name}>` : `<${name}>`;
    });

    // contenteditable leaves these behind constantly - a trailing empty
    // paragraph every time somebody presses Enter and thinks better of it.
    html = html.replace(/<(p|div|li|h3|h4|blockquote)>\s*(<br>\s*)*<\/\1>/gi, '');
    html = html.trim();

    return html.length > MAX_RICH_TEXT_LENGTH ? html.slice(0, MAX_RICH_TEXT_LENGTH) : html;
}

// The plain-text twin. Everything that already reads this record - the PDF
// export, the AI summaries, the assistant - expects `notes` to be text, so the
// rich version is stored alongside a flattened copy rather than replacing it.
function richTextToPlain(input) {
    if (input == null) return '';
    let text = String(input);
    text = text.replace(DROP_WITH_CONTENT, '');
    text = text.replace(/<\/(p|div|h3|h4|blockquote|ul|ol)\s*>/gi, '\n');
    text = text.replace(/<br\s*\/?>/gi, '\n');
    text = text.replace(/<li\b[^>]*>/gi, '\n- ');
    text = text.replace(/<[^>]+>/g, '');
    text = text
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'");
    // Collapse the runs of blank lines that the tag substitutions leave.
    return text.replace(/\n{3,}/g, '\n\n').replace(/[ \t]+\n/g, '\n').trim();
}

// True when the note has actual words in it, rather than the empty paragraph a
// contenteditable box reports as its "value" when nothing has been typed.
function hasRichTextContent(input) {
    return richTextToPlain(input).length > 0;
}

module.exports = {
    ALLOWED_TAGS,
    MAX_RICH_TEXT_LENGTH,
    sanitizeRichText,
    richTextToPlain,
    hasRichTextContent
};
