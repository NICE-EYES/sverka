// Thin adapter over pdf.js: returns positioned text items per page.
// `pdfjsLib` is injected so the same code runs in the browser (CDN build)
// and in Node tests (pdfjs-dist legacy build).

export class PasswordRequired extends Error {
  constructor(incorrect) {
    super(incorrect ? 'incorrect password' : 'password required');
    this.name = 'PasswordRequired';
    this.incorrect = incorrect;
  }
}

export async function extractPages(pdfjsLib, data, { password } = {}) {
  const task = pdfjsLib.getDocument({
    data,
    password,
    isEvalSupported: false,
    disableFontFace: true,
    useSystemFonts: false,
    verbosity: 0,
  });
  let doc;
  try {
    doc = await task.promise;
  } catch (e) {
    if (e && e.name === 'PasswordException') throw new PasswordRequired(e.code === 2);
    throw e;
  }
  const pages = [];
  let chars = 0;
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const vp = page.getViewport({ scale: 1 });
    const tc = await page.getTextContent();
    const items = [];
    for (const it of tc.items) {
      if (!('str' in it) || !it.str) continue;
      const [, , c, d, e, f] = it.transform;
      const [x, y] = vp.convertToViewportPoint(e, f);
      const h = Math.hypot(c, d) || it.height || 9;
      items.push({ str: it.str, x, y, w: it.width, h });
      chars += it.str.trim().length;
    }
    pages.push({ width: vp.width, height: vp.height, items });
    page.cleanup();
  }
  await doc.destroy();
  return { pages, numPages: pages.length, scanned: chars < 40 * pages.length };
}
