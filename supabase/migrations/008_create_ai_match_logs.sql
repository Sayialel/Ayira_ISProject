CREATE TABLE public.ai_match_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_id UUID NOT NULL REFERENCES public.users(id),
  gig_id UUID NOT NULL REFERENCES public.gigs(id),
  semantic_score NUMERIC(5,4),
  tfidf_score NUMERIC(5,4),
  location_match BOOLEAN,
  composite_score NUMERIC(5,4),
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.ai_match_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Workers see own match logs"
  ON public.ai_match_logs FOR SELECT
  USING (worker_id = auth.uid());

CREATE POLICY "Service can insert"
  ON public.ai_match_logs FOR INSERT
  WITH CHECK (true);
