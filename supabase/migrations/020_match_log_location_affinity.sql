-- Record the location affinity the engine actually computed.
--
-- ai_match_logs.location_match was a BOOLEAN, which was right when the signal
-- was a yes/no comparison of two town names. Location is now a tiered affinity
-- -- same town 1.0, same county 0.6, same metropolitan area 0.45, unknown 0.3,
-- different county 0.0 -- and storing that as a boolean throws away the whole
-- distinction the tiering exists to draw. A commute from Thika to Nairobi and a
-- flight from Mombasa would both land as false.
--
-- These logs exist so match quality can be analysed later, so they should hold
-- what was computed rather than a flattened version of it.
--
-- Renamed as well as retyped. "match" asked a question with a yes/no answer;
-- the column no longer answers that question, and leaving the old name would
-- invite the old reading.

ALTER TABLE public.ai_match_logs
  ADD COLUMN IF NOT EXISTS location_affinity NUMERIC(4,3);

-- Carry the existing rows across. true became a same-town match under the old
-- comparison, which is 1.0 on the new scale; false meant the towns differed,
-- which is 0.0. Nothing is invented: rows that were NULL stay NULL.
UPDATE public.ai_match_logs
   SET location_affinity = CASE
         WHEN location_match IS TRUE  THEN 1.0
         WHEN location_match IS FALSE THEN 0.0
         ELSE NULL
       END
 WHERE location_affinity IS NULL;

ALTER TABLE public.ai_match_logs DROP COLUMN IF EXISTS location_match;

COMMENT ON COLUMN public.ai_match_logs.location_affinity IS
  'Tiered location affinity 0-1 from app/services/scoring.location_affinity: '
  'same town 1.0, same county 0.6, same metro 0.45, unknown 0.3, different 0.0.';
