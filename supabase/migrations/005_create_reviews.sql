CREATE TABLE public.reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gig_id UUID NOT NULL REFERENCES public.gigs(id),
  reviewer_id UUID NOT NULL REFERENCES public.users(id),
  reviewee_id UUID NOT NULL REFERENCES public.users(id),
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(gig_id, reviewer_id)
);

ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read reviews"
  ON public.reviews FOR SELECT
  USING (true);

CREATE POLICY "Parties can write reviews"
  ON public.reviews FOR INSERT
  WITH CHECK (auth.uid() = reviewer_id);
