'use strict';

let ExifReader = null;
try {
    ExifReader = require('exifreader');
} catch (err) {
    console.warn('[exif-metadata] exifreader not available:', err.message);
}

// ─── Plugin entry point ────────────────────────────────────────────────────────

function activate(api) {
    return { extractEXIF, renderEXIFSection, copyEXIFJSON };
}

/**
 * Extract all EXIF/IPTC/XMP/GPS metadata from a file.
 * Returns the expanded ExifReader tags object, or null.
 */
async function extractEXIF(filePath) {
    if (!ExifReader) return null;
    try {
        const buf = await require('fs').promises.readFile(filePath);
        const tags = ExifReader.load(buf, { expanded: true });
        // Return null if there's truly nothing useful (only 'file' group)
        const groups = Object.keys(tags).filter(k => k !== 'file');
        if (groups.length === 0 && !tags.exif) return null;
        return tags;
    } catch (err) {
        if (err.name === 'MetadataMissingError') return null;
        console.warn('[exif-metadata] extractEXIF error:', err.message);
        return null;
    }
}

/**
 * Render the info section for the lightbox inspector.
 * Returns { title, html, actions, summary? } or null.
 */
async function renderEXIFSection(filePath, pluginMetadata) {
    const tags = pluginMetadata?.['exif-metadata'] ?? await extractEXIF(filePath);
    if (!tags) return null;

    const exif = tags.exif || {};
    const gps  = tags.gps  || {};
    const iptc = tags.iptc || {};
    const xmp  = tags.xmp  || {};

    const sections = [];

    // ── Camera ──────────────────────────────────────────────────────────────
    const cameraRows = [];
    const make  = desc(exif['Make']);
    const model = desc(exif['Model']);
    if (make || model) {
        const camera = [make, model].filter(Boolean).join(' ');
        // Avoid duplicating make inside model string (e.g. "Canon Canon EOS R5")
        const display = model?.startsWith(make ?? '\x00') ? model : camera;
        cameraRows.push(row('Camera', display));
    }
    const lensModel = desc(exif['LensModel']) || desc(exif['LensMake']);
    if (lensModel) cameraRows.push(row('Lens', lensModel));

    const focalLen = desc(exif['FocalLength']);
    const focalLen35 = desc(exif['FocalLengthIn35mmFilm']);
    if (focalLen) {
        const f35 = focalLen35 ? ` (${focalLen35}mm equiv.)` : '';
        cameraRows.push(row('Focal Length', `${focalLen}${f35}`));
    }

    const shutter = desc(exif['ExposureTime']);
    if (shutter) cameraRows.push(row('Shutter Speed', shutter));

    const aperture = desc(exif['FNumber']);
    if (aperture) cameraRows.push(row('Aperture', `f/${aperture}`));

    const iso = desc(exif['ISOSpeedRatings']) || desc(exif['PhotographicSensitivity']);
    if (iso) cameraRows.push(row('ISO', iso));

    const bias = desc(exif['ExposureBiasValue']);
    if (bias && bias !== '0') cameraRows.push(row('Exp. Bias', `${bias} EV`));

    const flash = desc(exif['Flash']);
    if (flash) cameraRows.push(row('Flash', flash));

    const wb = desc(exif['WhiteBalance']);
    if (wb) cameraRows.push(row('White Balance', wb));

    const metering = desc(exif['MeteringMode']);
    if (metering) cameraRows.push(row('Metering', metering));

    const expProg = desc(exif['ExposureProgram']);
    if (expProg && expProg !== 'Not defined') cameraRows.push(row('Exposure Mode', expProg));

    if (cameraRows.length) sections.push(group('Camera & Exposure', cameraRows));

    // ── Image ────────────────────────────────────────────────────────────────
    const imgRows = [];
    const w = desc(exif['PixelXDimension']);
    const h = desc(exif['PixelYDimension']);
    if (w && h) imgRows.push(row('Dimensions', `${w} × ${h}`));

    const orient = desc(exif['Orientation']);
    if (orient && orient !== 'top-left' && orient !== 'Horizontal (normal)') {
        imgRows.push(row('Orientation', orient));
    }

    const colorSpace = desc(exif['ColorSpace']);
    if (colorSpace) imgRows.push(row('Color Space', colorSpace));

    const dateTaken = desc(exif['DateTimeOriginal']) || desc(exif['DateTime']);
    if (dateTaken) imgRows.push(row('Date Taken', dateTaken));

    const software = desc(exif['Software']);
    if (software) imgRows.push(row('Software', software));

    const copyright = desc(exif['Copyright']) || desc(iptc['Copyright Notice']);
    if (copyright) imgRows.push(row('Copyright', copyright));

    if (imgRows.length) sections.push(group('Image Info', imgRows));

    // ── GPS ──────────────────────────────────────────────────────────────────
    const gpsRows = [];
    const lat = gps['GPSLatitude'];
    const lon = gps['GPSLongitude'];
    const latRef = desc(gps['GPSLatitudeRef']);
    const lonRef = desc(gps['GPSLongitudeRef']);

    if (lat && lon) {
        const latDec = toDecimalDeg(lat.value, latRef);
        const lonDec = toDecimalDeg(lon.value, lonRef);
        if (latDec !== null && lonDec !== null) {
            const coordStr = `${latDec.toFixed(6)}, ${lonDec.toFixed(6)}`;
            const mapsUrl  = `https://maps.google.com/?q=${latDec},${lonDec}`;
            gpsRows.push(`<div class="file-info-detail-row">
                <span class="file-info-detail-label">Coordinates:</span>
                <span class="file-info-detail-value">
                    <a href="#" class="exif-gps-link" data-url="${escHtml(mapsUrl)}" title="Open in Google Maps">${escHtml(coordStr)}</a>
                </span>
            </div>`);
        }
    }

    const alt = gps['GPSAltitude'];
    if (alt) gpsRows.push(row('Altitude', desc(alt)));

    const gpsDate = desc(gps['GPSDateStamp']);
    if (gpsDate) gpsRows.push(row('GPS Date', gpsDate));

    if (gpsRows.length) sections.push(group('GPS', gpsRows));

    // ── IPTC ─────────────────────────────────────────────────────────────────
    const iptcRows = [];

    const caption = desc(iptc['Caption/Abstract']) || desc(iptc['Object Name']);
    if (caption) iptcRows.push(row('Caption', caption));

    const keywords = iptc['Keywords'];
    if (keywords) {
        const kwList = Array.isArray(keywords.value)
            ? keywords.value.map(v => (typeof v === 'object' ? v.description ?? '' : String(v))).filter(Boolean).join(', ')
            : desc(keywords);
        if (kwList) iptcRows.push(row('Keywords', kwList));
    }

    const byline = desc(iptc['By-line']) || desc(iptc['Creator']);
    if (byline) iptcRows.push(row('Creator', byline));

    const city = desc(iptc['City']);
    const country = desc(iptc['Country/Primary Location Name']);
    if (city || country) iptcRows.push(row('Location', [city, country].filter(Boolean).join(', ')));

    if (iptcRows.length) sections.push(group('IPTC', iptcRows));

    // ── XMP ──────────────────────────────────────────────────────────────────
    const xmpRows = [];

    const rating = desc(xmp['Rating']);
    if (rating && rating !== '0') xmpRows.push(row('XMP Rating', '★'.repeat(Number(rating) || 0)));

    const label = desc(xmp['Label']);
    if (label) xmpRows.push(row('Label', label));

    const xmpDesc = desc(xmp['description']) || desc(xmp['Description']);
    if (xmpDesc && xmpDesc !== caption) xmpRows.push(row('Description', xmpDesc));

    const xmpCreator = desc(xmp['creator']) || desc(xmp['Creator']);
    if (xmpCreator && xmpCreator !== byline) xmpRows.push(row('XMP Creator', xmpCreator));

    if (xmpRows.length) sections.push(group('XMP', xmpRows));

    // ── Bail if nothing to show ───────────────────────────────────────────────
    if (sections.length === 0) return null;

    const html = sections.join('') + `
        <style>
            .exif-group-header { font-size: 11px; font-weight: 600; text-transform: uppercase;
                letter-spacing: 0.06em; opacity: 0.5; margin: 10px 0 4px; padding-top: 8px;
                border-top: 1px solid var(--border-subtle, rgba(255,255,255,0.08)); }
            .exif-group-header:first-child { margin-top: 0; border-top: none; padding-top: 0; }
            .exif-gps-link { color: var(--accent); text-decoration: underline; cursor: pointer; }
        </style>`;

    const actions = [{ label: 'Copy EXIF JSON', copyText: JSON.stringify(tags, null, 2) }];

    const summaryParts = [];
    const cameraSummary = model?.startsWith(make ?? '\x00') ? model : [make, model].filter(Boolean).join(' ');
    if (cameraSummary) summaryParts.push(cameraSummary);
    if (lensModel) summaryParts.push(lensModel);
    if (dateTaken) summaryParts.push(dateTaken);

    return {
        title: 'EXIF / Metadata',
        html,
        actions,
        summary: summaryParts.join(' · ')
    };
}

/**
 * Context menu action — returns JSON for clipboard copy.
 */
async function copyEXIFJSON(filePath, metadata) {
    const tags = metadata?.['exif-metadata'] ?? await extractEXIF(filePath);
    if (!tags) return { success: false, error: 'No EXIF data found' };
    return { success: true, json: JSON.stringify(tags, null, 2) };
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

/** Safely get the description string from an ExifReader tag. */
function desc(tag) {
    if (!tag) return null;
    const d = tag.description;
    if (d === null || d === undefined) return null;
    const s = String(d).trim();
    return s === '' || s === 'undefined' ? null : s;
}

/** Build a single label/value row. */
function row(label, value) {
    if (!value) return '';
    return `<div class="file-info-detail-row">
        <span class="file-info-detail-label">${escHtml(label)}:</span>
        <span class="file-info-detail-value">${escHtml(String(value))}</span>
    </div>`;
}

/** Wrap rows in a labelled group with a small sub-heading. */
function group(title, rows) {
    const content = rows.join('');
    if (!content) return '';
    return `<div class="exif-group-header">${escHtml(title)}</div>${content}`;
}

/**
 * Convert ExifReader GPS value (array of [num,denom] pairs) + ref string
 * to a signed decimal degree number.
 */
function toDecimalDeg(value, ref) {
    if (!Array.isArray(value) || value.length < 3) return null;
    const parts = value.map(v => {
        if (Array.isArray(v) && v.length === 2) return v[1] !== 0 ? v[0] / v[1] : 0;
        if (typeof v === 'number') return v;
        return 0;
    });
    const decimal = parts[0] + parts[1] / 60 + parts[2] / 3600;
    const negative = ref === 'S' || ref === 'W' ||
        (typeof ref === 'string' && (ref.includes('South') || ref.includes('West')));
    return negative ? -decimal : decimal;
}

function escHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

module.exports = { activate };
