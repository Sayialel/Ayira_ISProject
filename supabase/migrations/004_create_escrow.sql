CREATE TABLE public.escrow (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gig_id UUID NOT NULL REFERENCES public.gigs(id),
  employer_id UUID NOT NULL REFERENCES public.users(id),
  worker_id UUID NOT NULL REFERENCES public.users(id),
  amount NUMERIC(10,2) NOT NULL,
  currency TEXT DEFAULT 'KES',
  mpesa_checkout_id TEXT,
  mpesa_receipt TEXT,
  status TEXT NOT NULL CHECK (status IN (
    'pending','funded','released','disputed','refunded','partial_release','cancelled'
  )) DEFAULT 'pending',
  funded_at TIMESTAMPTZ,
  released_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.escrow ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Parties can view own escrow"
  ON public.escrow FOR SELECT
  USING (employer_id = auth.uid() OR worker_id = auth.uid());

CREATE POLICY "Employers can create escrow"
  ON public.escrow FOR INSERT
  WITH CHECK (auth.uid() = employer_id);

CREATE POLICY "Employers can update escrow"
  ON public.escrow FOR UPDATE
  USING (auth.uid() = employer_id);
