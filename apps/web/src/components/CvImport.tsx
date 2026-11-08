import { useRef, useState } from 'react';
import { FileText, Upload, X, ShieldCheck, Loader2 } from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { buildVocabulary, parseCvText, readFileText, type ParsedCv } from '@/lib/cvParser';

/**
 * Reads a CV and offers what it found, for the worker to accept or reject.
 *
 * Nothing is applied without confirmation. Dictionary matching cannot tell
 * "logistics clients" -- the employer's industry -- from logistics as
 * something the candidate can do, so a review step is not politeness, it is
 * how the feature stays correct. The worker also sees every term before it
 * reaches their public profile.
 *
 * The file is read in this component and never uploaded. See lib/cvParser.
 */

interface Props {
  /** Already on the profile, so the dialog can show what is new. */
  currentSkills: string[];
  currentBio: string;
  onApply: (choice: { skills: string[]; bio: string | null }) => void;
  onClose: () => void;
}

type Stage = 'choosing' | 'reading' | 'reviewing';

export default function CvImport({ currentSkills, currentBio, onApply, onClose }: Props) {
  const [stage, setStage] = useState<Stage>('choosing');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ParsedCv | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [takeBio, setTakeBio] = useState(true);
  const [pasted, setPasted] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);

  const existing = new Set(currentSkills.map((s) => s.toLowerCase()));

  async function run(getText: () => Promise<string>) {
    setStage('reading');
    setError(null);
    try {
      const [text, vocabulary] = await Promise.all([
        getText(),
        apiFetch<{
          categories: { name: string; skills: string[] }[];
          aliases: Record<string, string>;
        }>('/skills/vocabulary').then((v) => buildVocabulary(v.categories, v.aliases)),
      ]);

      const parsed = parseCvText(text, vocabulary);
      setResult(parsed);
      // Everything not already on the profile starts ticked: the common case
      // is accepting the lot, and unticking is easier than hunting.
      setPicked(new Set(parsed.skills.filter((s) => !existing.has(s.toLowerCase()))));
      setTakeBio(Boolean(parsed.about) && currentBio.trim().length === 0);
      setStage('reviewing');
    } catch (err) {
      setError((err as Error).message || 'Could not read that file');
      setStage('choosing');
    }
  }

  function toggle(skill: string) {
    setPicked((current) => {
      const next = new Set(current);
      if (next.has(skill)) next.delete(skill);
      else next.add(skill);
      return next;
    });
  }

  function apply() {
    onApply({
      skills: [...picked],
      bio: takeBio ? (result?.about ?? null) : null,
    });
  }

  const newSkills = (result?.skills ?? []).filter((s) => !existing.has(s.toLowerCase()));
  const alreadyHad = (result?.skills ?? []).filter((s) => existing.has(s.toLowerCase()));

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="cv-import-title"
    >
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white shadow-xl sm:rounded-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div>
            <h2 id="cv-import-title" className="font-display text-lg font-bold text-slate-900">
              Import from your CV
            </h2>
            <p className="mt-0.5 text-sm text-slate-600">
              We read it here on your device and suggest what to add.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
          >
            <X size={18} aria-hidden />
          </button>
        </div>

        <div className="px-5 py-4">
          <p className="mb-4 flex items-start gap-2 rounded-lg bg-emerald-50 px-3 py-2.5 text-xs text-emerald-900">
            <ShieldCheck size={15} className="mt-0.5 shrink-0" aria-hidden />
            <span>
              Your CV is never uploaded. It is read in your browser and nothing but the skills
              you tick below leaves this page.
            </span>
          </p>

          {error && (
            <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          )}

          {stage === 'reading' && (
            <p className="flex items-center justify-center gap-2 py-10 text-sm text-slate-600">
              <Loader2 size={16} className="animate-spin" aria-hidden />
              Reading your CV…
            </p>
          )}

          {stage === 'choosing' && (
            <div className="space-y-4">
              <button
                type="button"
                onClick={() => fileInput.current?.click()}
                className="flex w-full flex-col items-center gap-2 rounded-xl border-2 border-dashed border-slate-300 px-4 py-8 transition-colors hover:border-ayira-400 hover:bg-ayira-50/40"
              >
                <Upload size={24} className="text-slate-400" aria-hidden />
                <span className="text-sm font-medium text-slate-900">Choose a file</span>
                <span className="text-xs text-slate-500">PDF, Word (.docx) or .txt</span>
              </button>
              <input
                ref={fileInput}
                type="file"
                accept=".pdf,.docx,.txt,application/pdf,text/plain"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void run(() => readFileText(file));
                  // Cleared so picking the same file twice fires onChange again.
                  e.target.value = '';
                }}
              />

              <div className="flex items-center gap-3 text-xs text-slate-400">
                <span className="h-px flex-1 bg-slate-200" />
                or paste it
                <span className="h-px flex-1 bg-slate-200" />
              </div>

              <textarea
                value={pasted}
                onChange={(e) => setPasted(e.target.value)}
                rows={5}
                placeholder="Paste your CV text here…"
                aria-label="CV text"
                className="w-full resize-y rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-ayira-500 focus:outline-none focus:ring-1 focus:ring-ayira-500"
              />
              <button
                type="button"
                disabled={pasted.trim().length < 30}
                onClick={() => void run(async () => pasted)}
                className="w-full rounded-lg bg-ayira-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-ayira-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Read pasted text
              </button>
            </div>
          )}

          {stage === 'reviewing' && result && (
            <div className="space-y-5">
              {result.skills.length === 0 && (
                <div className="rounded-lg border border-gold-200 bg-gold-50 px-3 py-3 text-sm text-gold-900">
                  <p className="font-medium">We could not recognise any skills.</p>
                  <p className="mt-1 text-xs">
                    {result.textLength < 120
                      ? 'Very little text came out of that file — if it is a scanned image, try pasting the text instead.'
                      : 'Your CV may use wording we do not know yet. You can still add skills by hand.'}
                  </p>
                </div>
              )}

              {newSkills.length > 0 && (
                <div>
                  <p className="mb-2 text-sm font-medium text-slate-900">
                    Found {newSkills.length} new {newSkills.length === 1 ? 'skill' : 'skills'} —
                    untick anything that is not yours
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {newSkills.map((skill) => {
                      const on = picked.has(skill);
                      return (
                        <button
                          key={skill}
                          type="button"
                          onClick={() => toggle(skill)}
                          aria-pressed={on}
                          className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${
                            on
                              ? 'border-ayira-600 bg-ayira-600 text-white'
                              : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'
                          }`}
                        >
                          {skill}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {alreadyHad.length > 0 && (
                <p className="text-xs text-slate-500">
                  Already on your profile: {alreadyHad.join(', ')}
                </p>
              )}

              {result.about && (
                <div className="rounded-lg border border-slate-200 p-3">
                  <label className="flex items-start gap-2.5">
                    <input
                      type="checkbox"
                      checked={takeBio}
                      onChange={(e) => setTakeBio(e.target.checked)}
                      className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 text-ayira-600 focus:ring-ayira-500"
                    />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-slate-900">
                        Use this as your About section
                        {currentBio.trim() && (
                          <span className="font-normal text-red-600"> (replaces what is there)</span>
                        )}
                      </span>
                      <span className="mt-1 block text-xs text-slate-600">{result.about}</span>
                    </span>
                  </label>
                </div>
              )}

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setStage('choosing');
                    setResult(null);
                  }}
                  className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
                >
                  Try another file
                </button>
                <button
                  type="button"
                  onClick={apply}
                  disabled={picked.size === 0 && !takeBio}
                  className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-ayira-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-ayira-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <FileText size={15} aria-hidden />
                  Add to my profile
                </button>
              </div>
              <p className="text-center text-xs text-slate-400">
                Nothing is saved until you press Save on your profile.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
