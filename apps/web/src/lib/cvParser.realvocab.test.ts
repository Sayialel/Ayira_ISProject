import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { buildVocabulary, parseCvText } from './cvParser';

/**
 * The unit tests above use a 15-term vocabulary so each case is readable.
 * This one runs the real 852-term one, because the failure modes that matter
 * at that size -- a short term matching inside an unrelated longer phrase,
 * or a flood of near-duplicate hits -- cannot appear in a toy vocabulary.
 */

const voc = JSON.parse(
  readFileSync(
    join(__dirname, '../../../ai-engine/eval/corpus_sources/skills_vocabulary.json'),
    'utf-8'
  )
);

const VOCAB = buildVocabulary(
  Object.entries(voc.skills).map(([name, skills]) => ({ name, skills: skills as string[] })),
  voc.aliases
);

const TECH_CV = `
BRIAN OTIENO
brian.otieno@example.com | +254 712 345 678 | Kisumu, Kenya

CAREER OBJECTIVE
A full stack developer with three years building web applications for Kenyan
SMEs, looking for remote contract work in React and Node.js.

TECHNICAL SKILLS
Languages: JavaScript, TypeScript, Python, SQL
Frameworks: React, Node.js, Django
Tools: Git, Docker, Figma
Payments: M-Pesa integration via the Daraja API

WORK EXPERIENCE
Software Developer, Acme Systems, Nairobi, 2023 to date
- Built dashboards and reports for logistics clients
- Handled data migration from legacy systems

EDUCATION
BSc Computer Science, Maseno University, 2022

REFERENCES
Available upon request.
`;

const TRADE_CV = `
GRACE MUTHONI
Thika, Kiambu County | 0722 000 111

PERSONAL PROFILE
An experienced tailor and dressmaker with eight years running a small shop in
Thika. I also do beauty therapy and hairdressing for walk-in clients.

SKILLS
Tailoring, dressmaking, hairdressing, beauty therapy, nail technology
Customer care and basic bookkeeping
Mobile money agency (M-Pesa)

EXPERIENCE
Self-employed tailor, Thika market, 2018 to date
`;

describe('against the real vocabulary', () => {
  it('reads a technology CV', () => {
    const r = parseCvText(TECH_CV, VOCAB);
    expect(r.skills).toEqual(
      expect.arrayContaining(['JavaScript', 'TypeScript', 'Python', 'SQL', 'React', 'Node.js'])
    );
    expect(r.about).toContain('full stack developer');
    // The contact line is the thing that must not reach a public bio.
    expect(r.about).not.toContain('example.com');
    expect(r.about).not.toContain('254');
  });

  it('reads an informal-sector CV', () => {
    const r = parseCvText(TRADE_CV, VOCAB);
    expect(r.skills).toEqual(
      expect.arrayContaining(['Tailoring', 'Hairdressing', 'Beauty Therapy'])
    );
    expect(r.about).toContain('experienced tailor');
  });

  it('does not return an unusable flood of skills', () => {
    // A ~850-term vocabulary matched loosely would tag a CV with dozens of
    // overlapping terms and make the review step useless.
    for (const cv of [TECH_CV, TRADE_CV]) {
      const { skills } = parseCvText(cv, VOCAB);
      expect(skills.length).toBeGreaterThan(3);
      expect(skills.length).toBeLessThan(30);
    }
  });

  it('finds nothing in a CV with no recognisable skills', () => {
    const { skills } = parseCvText(
      'JOHN DOE\nNairobi\n\nEXPERIENCE\nI have worked in various places doing various things.',
      VOCAB
    );
    expect(skills.length).toBeLessThan(3);
  });
});
