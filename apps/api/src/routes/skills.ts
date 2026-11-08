import { Router } from 'express';
import { supabaseAdmin } from '../lib/supabase';
import { asyncHandler } from '../lib/asyncHandler';
import { assertNoDbError } from '../lib/http';

export const skillRouter = Router();

/**
 * The skills vocabulary, for the CV parser.
 *
 * Served as one document rather than searched server-side because the parser
 * runs in the browser. The CV is read there and never uploaded: it carries a
 * name, a phone number, often an ID number, a physical address and referees'
 * contact details, and under the Data Protection Act 2019 that is personal
 * data this platform would become the controller of the moment it arrived.
 * Not receiving it is cheaper than securing it.
 *
 * So the browser needs the whole vocabulary to match against. It is about
 * 850 terms and 67 aliases -- roughly 20 KB, cached, reference data that
 * changes only when the generator is re-run.
 */

skillRouter.get(
  '/vocabulary',
  asyncHandler(async (_req, res) => {
    const [categories, aliases] = await Promise.all([
      supabaseAdmin.from('skill_categories').select('id, name, skills').order('name'),
      supabaseAdmin.from('skill_aliases').select('alias, canonical'),
    ]);

    assertNoDbError(categories.error, 'Failed to load the skills vocabulary');
    assertNoDbError(aliases.error, 'Failed to load the skill aliases');

    // Reference data, identical for every caller, so it is worth letting the
    // browser keep it. An hour is short enough that a regenerated vocabulary
    // appears the same day and long enough that opening the importer twice
    // does not fetch it twice.
    res.set('Cache-Control', 'private, max-age=3600');

    res.json({
      data: {
        categories: categories.data ?? [],
        aliases: Object.fromEntries(
          (aliases.data ?? []).map((row) => [row.alias, row.canonical])
        ),
      },
    });
  })
);
