CREATE TABLE public.applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gig_id UUID NOT NULL REFERENCES public.gigs(id) ON DELETE CASCADE,
  worker_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  cover_letter TEXT,
  proposed_amount NUMERIC(10,2),
  ai_match_score NUMERIC(5,4),
  status TEXT NOT NULL CHECK (status IN ('pending','shortlisted','accepted','rejected','withdrawn')) DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(gig_id, worker_id)
);

ALTER TABLE public.applications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Workers see own applications"
  ON public.applications FOR SELECT
  USING (worker_id = auth.uid());

CREATE POLICY "Employers see applications to their gigs"
  ON public.applications FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.gigs WHERE gigs.id = applications.gig_id AND gigs.employer_id = auth.uid()
  ));

CREATE POLICY "Workers can apply"
  ON public.applications FOR INSERT
  WITH CHECK (auth.uid() = worker_id);

CREATE POLICY "Workers can withdraw"
  ON public.applications FOR UPDATE
  USING (auth.uid() = worker_id);

CREATE POLICY "Employers can update application status"
  ON public.applications FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM public.gigs WHERE gigs.id = applications.gig_id AND gigs.employer_id = auth.uid()
  ));
