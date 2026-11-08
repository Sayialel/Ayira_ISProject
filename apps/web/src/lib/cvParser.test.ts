import { describe, it, expect } from 'vitest';
import {
  buildVocabulary,
  extractSkills,
  extractAbout,
  parseCvText,
} from './cvParser';

/**
 * The cases that matter are the ones where a naive matcher is confidently
 * wrong: overlapping phrases, substrings inside unrelated words, and section
 * headings that happen to be real vocabulary terms.
 */

const VOCAB = buildVocabulary(
  [
    {
      name: 'Technology',
      skills: ['Python', 'JavaScript', 'React', 'Node.js', 'Data Entry', 'SQL', 'Data Analysis'],
    },
    {
      name: 'Marketing',
      skills: ['Marketing', 'Digital Marketing', 'Social Media Marketing', 'SEO'],
    },
    { name: 'Design', skills: ['Graphic Design', 'Adobe Photoshop'] },
    { name: 'Business', skills: ['Welding', 'Plumbing', 'Training', 'Bookkeeping', 'Driving'] },
  ],
  { js: 'JavaScript', 'ms excel': 'Microsoft Excel', photoshop: 'Adobe Photoshop', fundi: 'Plumbing' }
);

describe('extractSkills', () => {
  it('finds plain terms', () => {
    expect(extractSkills('Skilled in Python and SQL.', VOCAB)).toEqual(['Python', 'SQL']);
  });

  it('is case-insensitive and survives punctuation', () => {
    expect(extractSkills('python, REACT; node.js', VOCAB)).toEqual(
      expect.arrayContaining(['Python', 'React', 'Node.js'])
    );
  });

  it('prefers the longest phrase and does not also report its parts', () => {
    // The regression this guards: "Social Media Marketing" must not also
    // yield "Marketing", or the worker unchecks the same thing twice.
    const found = extractSkills('I do Social Media Marketing for brands.', VOCAB);
    expect(found).toContain('Social Media Marketing');
    expect(found).not.toContain('Marketing');
  });

  it('still finds a shorter term used separately', () => {
    const found = extractSkills('Social Media Marketing. Also general Marketing strategy.', VOCAB);
    expect(found).toContain('Social Media Marketing');
    expect(found).toContain('Marketing');
  });

  it('requires word boundaries, so it does not match inside a word', () => {
    // "SQL" inside "NoSQLish", "React" inside "Reactionary".
    expect(extractSkills('Reactionary views on NoSQLish stores', VOCAB)).toEqual([]);
  });

  it('ignores a bare section heading that is also a vocabulary term', () => {
    // "Training" and "Education" head a section on most CVs. Reporting them
    // as skills from the heading alone would be noise.
    expect(extractSkills('TRAINING\nEDUCATION\nREFERENCES', VOCAB)).toEqual([]);
  });

  it('resolves aliases to the canonical term', () => {
    expect(extractSkills('Strong JS skills', VOCAB)).toEqual(['JavaScript']);
    expect(extractSkills('Worked as a fundi', VOCAB)).toEqual(['Plumbing']);
  });

  it('prefers an explicit mention over an alias for the same skill', () => {
    const found = extractSkills('JavaScript and JS both appear', VOCAB);
    expect(found.filter((s) => s === 'JavaScript')).toHaveLength(1);
  });

  it('ignores an alias pointing at a term not in the vocabulary', () => {
    // "ms excel" aliases to Microsoft Excel, which this vocabulary lacks.
    expect(extractSkills('Advanced MS Excel user', VOCAB)).toEqual([]);
  });

  it('returns skills in the order they appear', () => {
    expect(extractSkills('First Welding, then Python, then SEO.', VOCAB)).toEqual([
      'Welding',
      'Python',
      'SEO',
    ]);
  });

  it('deduplicates a skill mentioned repeatedly', () => {
    expect(extractSkills('Python. More Python. Even more Python.', VOCAB)).toEqual(['Python']);
  });

  it('finds nothing in an empty or useless CV', () => {
    expect(extractSkills('', VOCAB)).toEqual([]);
    expect(extractSkills('References available upon request.', VOCAB)).toEqual([]);
  });
});

describe('extractAbout', () => {
  const CV = [
    'JANE WANJIKU',
    'jane@example.com | +254 700 000 000 | Nairobi',
    '',
    'PROFESSIONAL SUMMARY',
    'A graphic designer with four years of experience in brand identity and print',
    'production for Nairobi retail clients.',
    '',
    'WORK EXPERIENCE',
    'Designer, Acme Ltd, 2022 to date',
  ].join('\n');

  it('takes the summary section, not the top of the document', () => {
    const about = extractAbout(CV);
    expect(about).toContain('graphic designer with four years');
    // The contact block is the thing most worth not copying into a public bio.
    expect(about).not.toContain('jane@example.com');
    expect(about).not.toContain('+254');
  });

  it('stops at the next section heading', () => {
    expect(extractAbout(CV)).not.toContain('Acme Ltd');
  });

  it('returns null when there is no summary section', () => {
    expect(extractAbout('JANE WANJIKU\nWORK EXPERIENCE\nDesigner, Acme Ltd')).toBeNull();
  });

  it('returns null when the summary is too short to be a bio', () => {
    expect(extractAbout('SUMMARY\nDesigner.')).toBeNull();
  });

  it('respects the 500-character bio limit', () => {
    const long = `SUMMARY\n${'word '.repeat(300)}`;
    const about = extractAbout(long);
    expect(about).not.toBeNull();
    expect(about!.length).toBeLessThanOrEqual(501);   // 500 plus the ellipsis
  });

  it('recognises the headings Kenyan CVs actually use', () => {
    for (const heading of ['CAREER OBJECTIVE', 'Personal Profile', 'About Me']) {
      const text = `${heading}\nAn experienced welder seeking contract work across Nairobi County.`;
      expect(extractAbout(text), heading).toContain('experienced welder');
    }
  });
});

describe('parseCvText', () => {
  it('reports both results and how much text it read', () => {
    const result = parseCvText(
      'CAREER OBJECTIVE\nAn experienced plumber looking for contract work in Nairobi.\n\nSKILLS\nPlumbing, Welding',
      VOCAB
    );
    expect(result.skills).toEqual(expect.arrayContaining(['Plumbing', 'Welding']));
    expect(result.about).toContain('experienced plumber');
    expect(result.textLength).toBeGreaterThan(50);
  });

  it('degrades to nothing rather than throwing on junk input', () => {
    const result = parseCvText('\u0000\u0001 ... ???', VOCAB);
    expect(result.skills).toEqual([]);
    expect(result.about).toBeNull();
  });
});
