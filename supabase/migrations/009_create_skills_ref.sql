CREATE TABLE public.skill_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  skills TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.skill_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read skills"
  ON public.skill_categories FOR SELECT
  USING (true);

-- Seed common categories
INSERT INTO public.skill_categories (name, skills) VALUES
  ('Technology', ARRAY['Python','JavaScript','React','Node.js','Flutter','Data Analysis','UI/UX Design']),
  ('Writing', ARRAY['Content Writing','Copywriting','Technical Writing','Translation','Transcription']),
  ('Design', ARRAY['Graphic Design','Logo Design','Video Editing','Photography','Animation']),
  ('Marketing', ARRAY['Social Media','SEO','Email Marketing','Digital Advertising','Influencer Marketing']),
  ('Business', ARRAY['Virtual Assistant','Data Entry','Customer Service','Project Management','Accounting']);
