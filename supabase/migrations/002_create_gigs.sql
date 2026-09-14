CREATE TABLE public.gigs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employer_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  category TEXT NOT NULL,
  required_skills TEXT[] DEFAULT '{}',
  location TEXT,
  is_remote BOOLEAN DEFAULT FALSE,
  budget_min NUMERIC(10,2),
  budget_max NUMERIC(10,2),
  currency TEXT DEFAULT 'KES',
  deadline TIMESTAMPTZ,
  status TEXT NOT NULL CHECK (status IN ('draft','open','in_progress','completed','cancelled')) DEFAULT 'draft',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.gigs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view open gigs"
  ON public.gigs FOR SELECT
  USING (status = 'open' OR employer_id = auth.uid());

CREATE POLICY "Employers can create gigs"
  ON public.gigs FOR INSERT
  WITH CHECK (auth.uid() = employer_id);

CREATE POLICY "Employers can update own gigs"
  ON public.gigs FOR UPDATE
  USING (auth.uid() = employer_id);
