/**
 * Reads a CV and proposes skills and an "about" paragraph from it.
 *
 * Everything here runs in the browser and the file is never uploaded. A CV
 * carries a name, a phone number, usually an email, often an ID number, a
 * physical address and referees' contact details. Under the Data Protection
 * Act 2019 that is personal data, and the moment it reached a server this
 * platform would be its controller. Not receiving it at all is both cheaper
 * and more defensible than securing it.
 *
 * Skills are matched against the platform's own vocabulary rather than
 * extracted freely. Free extraction looks better in a demonstration and is
 * worse in practice: the noise -- "References available on request", town
 * names, dates, referees -- would land in `skills`, which is half of the
 * `profile_text` the matcher embeds. Matching a fixed list is also
 * explainable, which matters because the worker is shown what was found and
 * asked to confirm it.
 */

export interface Vocabulary {
  /** Canonical skill -> its category, for grouping what was found. */
  byCategory: Map<string, string>;
  /** Lower-cased written form -> canonical skill. */
  aliases: Map<string, string>;
}

export interface ParsedCv {
  /** Canonical skills found, in the order a reader would meet them. */
  skills: string[];
  /** A proposed bio, or null when the CV had no usable prose. */
  about: string | null;
  /** How many characters of text were read, so the UI can say if it got little. */
  textLength: number;
}

/** Builds the lookup structures once per import, from the API response. */
export function buildVocabulary(
  categories: { name: string; skills: string[] }[],
  aliases: Record<string, string>
): Vocabulary {
  const byCategory = new Map<string, string>();
  for (const category of categories) {
    for (const skill of category.skills) byCategory.set(skill, category.name);
  }
  return {
    byCategory,
    aliases: new Map(Object.entries(aliases).map(([k, v]) => [k.toLowerCase(), v])),
  };
}

/**
 * Normalises text for matching.
 *
 * Collapses whitespace, lower-cases, and drops punctuation that separates
 * rather than spells. The distinction is finer than it looks: '.' has to
 * survive inside "Node.js" and disappear after "Python." at the end of a
 * sentence, or every skill written last in a sentence goes unfound. So a dot
 * is kept only when a letter or digit follows it. '+', '#' and '-' are always
 * kept, because they only ever spell -- C++, C#, full-stack.
 *
 * The result is padded with a space at both ends so a whole-phrase search can
 * require a word boundary with `includes` rather than a regular expression
 * per term. With ~850 terms that difference is most of the runtime.
 */
function normalise(text: string): string {
  return ` ${text
    .toLowerCase()
    .replace(/[‘’“”]/g, "'")
    .replace(/[^a-z0-9.+#\-\s]/g, ' ')
    .replace(/\.(?![a-z0-9])/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()} `;
}

/** Whether `needle` appears in `haystack` on word boundaries. */
function containsPhrase(haystack: string, needle: string): boolean {
  const target = ` ${needle} `;
  return haystack.includes(target);
}

/**
 * Phrases that would match something harmless and mean nothing here.
 *
 * "Training" appears in "Training and Development" on half of all CVs and as
 * a heading on the other half; "Education" is a section title. Both are in the
 * vocabulary as legitimate skills, so they are only skipped when they appear
 * as a bare section heading rather than inside a longer phrase.
 */
const HEADING_WORDS = new Set([
  'education',
  'training',
  'skills',
  'experience',
  'references',
  'interests',
  'languages',
  'profile',
  'objective',
  'summary',
]);

/**
 * Finds vocabulary skills in CV text.
 *
 * Longest-first, so "Social Media Marketing" is found and "Marketing" is not
 * also reported from the same words. Without that, a CV saying "Digital
 * Marketing Manager" would yield three overlapping skills and the worker
 * would have to uncheck two of them.
 */
export function extractSkills(text: string, vocabulary: Vocabulary): string[] {
  const haystack = normalise(text);
  const found = new Map<string, number>();     // canonical -> first position used

  const terms = [...vocabulary.byCategory.keys()].sort((a, b) => b.length - a.length);

  // Spans already taken by a longer term, so a shorter one spelled inside it
  // is not also reported.
  const claimed: [number, number][] = [];

  function overlapsClaim(start: number, end: number): boolean {
    return claimed.some(([s, e]) => start < e && end > s);
  }

  /**
   * The first occurrence of `needle` that no longer term has claimed.
   *
   * Every occurrence is scanned, not just the first. "Social Media Marketing.
   * Also general Marketing strategy." has to yield both: the first
   * "marketing" is inside the longer phrase and taken, and stopping there
   * would lose the standalone one later in the line.
   */
  function firstUnclaimed(needle: string): number {
    let at = haystack.indexOf(` ${needle} `);
    while (at !== -1) {
      const start = at + 1;
      if (!overlapsClaim(start, start + needle.length)) return start;
      at = haystack.indexOf(` ${needle} `, at + 1);
    }
    return -1;
  }

  for (const term of terms) {
    const needle = normalise(term).trim();
    if (!needle) continue;
    if (needle.split(' ').length === 1 && HEADING_WORDS.has(needle)) continue;

    const start = firstUnclaimed(needle);
    if (start === -1) continue;

    claimed.push([start, start + needle.length]);
    if (!found.has(term)) found.set(term, start);
  }

  // Aliases run after the canonical pass, so an explicit "JavaScript" wins
  // over inferring it from "JS", and an alias is only consulted for a skill
  // not already found.
  for (const [alias, canonical] of vocabulary.aliases) {
    if (found.has(canonical)) continue;
    if (!vocabulary.byCategory.has(canonical)) continue;   // alias to a retired term
    const needle = normalise(alias).trim();
    if (!needle) continue;

    const start = firstUnclaimed(needle);
    if (start === -1) continue;

    claimed.push([start, start + needle.length]);
    found.set(canonical, start);
  }

  return [...found.entries()].sort((a, b) => a[1] - b[1]).map(([skill]) => skill);
}

/** Section headings that introduce the paragraph people write about themselves. */
const ABOUT_HEADINGS = [
  'professional summary',
  'career summary',
  'personal statement',
  'career objective',
  'professional profile',
  'personal profile',
  'about me',
  'summary',
  'objective',
  'profile',
];

/** Headings that end it. */
const NEXT_SECTION = [
  'work experience',
  'professional experience',
  'employment history',
  'education',
  'qualifications',
  'skills',
  'key skills',
  'technical skills',
  'certifications',
  'references',
  'interests',
  'languages',
  'achievements',
  'employment',
  'experience',
];

const ABOUT_MIN = 40;
const ABOUT_MAX = 500;         // the bio column's limit

/**
 * Pulls the candidate's own summary out of a CV.
 *
 * Preferred over the first N characters, which on most CVs is a name, a phone
 * number and an email -- contact details rather than anything about the work,
 * and exactly the personal data worth not propagating into a public profile.
 * Returns null rather than guessing when no summary section is found.
 */
export function extractAbout(text: string): string | null {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  const headingIndex = lines.findIndex((line) => {
    const bare = line.toLowerCase().replace(/[^a-z ]/g, '').trim();
    return bare.length <= 30 && ABOUT_HEADINGS.includes(bare);
  });

  if (headingIndex === -1) return null;

  const collected: string[] = [];
  for (const line of lines.slice(headingIndex + 1)) {
    const bare = line.toLowerCase().replace(/[^a-z ]/g, '').trim();
    if (bare.length <= 30 && NEXT_SECTION.includes(bare)) break;
    collected.push(line);
    if (collected.join(' ').length >= ABOUT_MAX) break;
  }

  const about = collected.join(' ').trim();
  if (about.length < ABOUT_MIN) return null;

  if (about.length <= ABOUT_MAX) return about;
  // Cut at a sentence end if there is one in the last fifth, so the bio does
  // not stop mid-word.
  const clipped = about.slice(0, ABOUT_MAX);
  const lastStop = clipped.lastIndexOf('. ');
  return lastStop > ABOUT_MAX * 0.8 ? clipped.slice(0, lastStop + 1) : `${clipped.trim()}…`;
}

/** Runs both extractors over already-extracted text. */
export function parseCvText(text: string, vocabulary: Vocabulary): ParsedCv {
  return {
    skills: extractSkills(text, vocabulary),
    about: extractAbout(text),
    textLength: text.trim().length,
  };
}

/**
 * Turns a file into text.
 *
 * pdfjs and mammoth are imported dynamically so neither reaches the main
 * bundle: between them they are larger than the whole application, and only
 * someone who opens the importer needs either.
 */
export async function readFileText(file: File): Promise<string> {
  const name = file.name.toLowerCase();

  if (name.endsWith('.txt') || file.type === 'text/plain') {
    return file.text();
  }

  if (name.endsWith('.pdf') || file.type === 'application/pdf') {
    const pdfjs = await import('pdfjs-dist');
    // The worker is bundled by Vite rather than fetched from a CDN, so the
    // importer works offline and is not broken by someone else's outage.
    const worker = await import('pdfjs-dist/build/pdf.worker.mjs?url');
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default;

    const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
    const pages: string[] = [];
    for (let n = 1; n <= doc.numPages; n += 1) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      // Items carry no line breaks, so a y-position change is the only signal
      // that a new line started -- and headings depend on lines.
      let lastY: number | null = null;
      let line = '';
      const lines: string[] = [];
      for (const item of content.items as { str: string; transform: number[] }[]) {
        const y = item.transform?.[5] ?? null;
        if (lastY !== null && y !== null && Math.abs(y - lastY) > 2) {
          lines.push(line);
          line = '';
        }
        line += item.str;
        lastY = y;
      }
      lines.push(line);
      pages.push(lines.join('\n'));
    }
    return pages.join('\n');
  }

  if (name.endsWith('.docx')) {
    const mammoth = await import('mammoth/mammoth.browser');
    const { value } = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
    return value;
  }

  throw new Error('Upload a PDF, a Word .docx or a .txt file, or paste the text instead.');
}
