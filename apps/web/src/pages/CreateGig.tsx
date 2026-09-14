import { FormEvent, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApi } from '@/hooks/useApi';
import { apiFetch } from '@/lib/api';
import SkillsInput from '@/components/SkillsInput';
import { ErrorMessage, Spinner, usePageTitle } from '@/components/ui';
import type { Gig, SkillCategory } from '@/types';

const MIN_TITLE = 5;
const MIN_DESCRIPTION = 20;

/** Tomorrow, as the earliest date the deadline picker will accept. */
function minDeadline(): string {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  return date.toISOString().slice(0, 10);
}

export default function CreateGig() {
  usePageTitle('Post a gig');
  const navigate = useNavigate();

  const { data: categories } = useApi<SkillCategory[]>('/gigs/meta/categories');

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const [skills, setSkills] = useState<string[]>([]);
  const [isRemote, setIsRemote] = useState(false);
  const [location, setLocation] = useState('');
  const [budgetMin, setBudgetMin] = useState('');
  const [budgetMax, setBudgetMax] = useState('');
  const [deadline, setDeadline] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Suggestions follow the chosen category, falling back to every seeded skill.
  const suggestions = useMemo(() => {
    if (!categories) return [];
    const matched = categories.find((c) => c.name === category);
    return matched ? matched.skills : categories.flatMap((c) => c.skills);
  }, [categories, category]);

  /** Client-side mirror of the server's Zod rules, so errors surface earlier. */
  function validate(): string | null {
    if (title.trim().length < MIN_TITLE) {
      return `Title must be at least ${MIN_TITLE} characters.`;
    }
    if (description.trim().length < MIN_DESCRIPTION) {
      return `Description must be at least ${MIN_DESCRIPTION} characters.`;
    }
    if (!category) return 'Choose a category.';
    if (!isRemote && !location.trim()) {
      return 'Add a location, or mark the gig as remote.';
    }
    const min = Number(budgetMin);
    const max = Number(budgetMax);
    if (!budgetMin || !Number.isFinite(min) || min <= 0) {
      return 'Enter a minimum budget greater than zero.';
    }
    if (!budgetMax || !Number.isFinite(max) || max <= 0) {
      return 'Enter a maximum budget greater than zero.';
    }
    if (max < min) return 'Maximum budget must be at least the minimum budget.';
    if (!deadline) return 'Choose a deadline.';
    if (new Date(deadline).getTime() <= Date.now()) {
      return 'The deadline must be in the future.';
    }
    return null;
  }

  async function handleSubmit(event: FormEvent, publish: boolean) {
    event.preventDefault();
    setError(null);

    const problem = validate();
    if (problem) {
      setError(problem);
      return;
    }

    setSubmitting(true);
    try {
      const gig = await apiFetch<Gig>('/gigs', {
        method: 'POST',
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim(),
          category,
          required_skills: skills,
          is_remote: isRemote,
          ...(location.trim() && { location: location.trim() }),
          budget_min: Number(budgetMin),
          budget_max: Number(budgetMax),
          // Gigs close at the end of the chosen day.
          deadline: new Date(`${deadline}T23:59:59`).toISOString(),
        }),
      });

      // Gigs are always created as drafts; publishing is a second step so the
      // employer can save and come back to it.
      if (publish) {
        await apiFetch<Gig>(`/gigs/${gig.id}/publish`, { method: 'PATCH' });
      }

      navigate(`/app/gigs/${gig.id}`);
    } catch (err) {
      setError((err as Error).message);
      setSubmitting(false);
    }
  }

  const inputClass =
    'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-ayira-500 focus:outline-none focus:ring-1 focus:ring-ayira-500';

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-bold">Post a gig</h1>
      <p className="mb-6 text-sm text-gray-500">
        Save it as a draft first, or publish it straight to the feed.
      </p>

      <form className="space-y-5" onSubmit={(e) => handleSubmit(e, true)}>
        {error && <ErrorMessage message={error} />}

        <div>
          <label htmlFor="title" className="mb-1 block text-sm font-medium text-gray-700">
            Title
          </label>
          <input
            id="title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Build a landing page in React"
            className={inputClass}
          />
        </div>

        <div>
          <label htmlFor="description" className="mb-1 block text-sm font-medium text-gray-700">
            Description
          </label>
          <textarea
            id="description"
            rows={6}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Describe the work, what success looks like, and anything the worker needs to know."
            className={inputClass}
          />
          <p className="mt-1 text-xs text-gray-400">
            {description.trim().length}/{MIN_DESCRIPTION} characters minimum
          </p>
        </div>

        <div>
          <label htmlFor="category" className="mb-1 block text-sm font-medium text-gray-700">
            Category
          </label>
          <select
            id="category"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className={inputClass}
          >
            <option value="">Choose a category</option>
            {(categories ?? []).map((c) => (
              <option key={c.id} value={c.name}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="skills" className="mb-1 block text-sm font-medium text-gray-700">
            Required skills
          </label>
          <SkillsInput
            id="skills"
            value={skills}
            onChange={setSkills}
            suggestions={suggestions}
          />
        </div>

        <fieldset>
          <legend className="mb-1 text-sm font-medium text-gray-700">Location</legend>
          <label className="mb-2 flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={isRemote}
              onChange={(e) => setIsRemote(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-ayira-600 focus:ring-ayira-500"
            />
            This gig can be done remotely
          </label>
          <input
            type="text"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder={isRemote ? 'Optional preferred location' : 'e.g. Nairobi'}
            aria-label="Location"
            className={inputClass}
          />
        </fieldset>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="budget_min" className="mb-1 block text-sm font-medium text-gray-700">
              Budget from (KES)
            </label>
            <input
              id="budget_min"
              type="number"
              min={1}
              step={100}
              value={budgetMin}
              onChange={(e) => setBudgetMin(e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="budget_max" className="mb-1 block text-sm font-medium text-gray-700">
              Budget to (KES)
            </label>
            <input
              id="budget_max"
              type="number"
              min={1}
              step={100}
              value={budgetMax}
              onChange={(e) => setBudgetMax(e.target.value)}
              className={inputClass}
            />
          </div>
        </div>

        <div>
          <label htmlFor="deadline" className="mb-1 block text-sm font-medium text-gray-700">
            Deadline
          </label>
          <input
            id="deadline"
            type="date"
            min={minDeadline()}
            value={deadline}
            onChange={(e) => setDeadline(e.target.value)}
            className={inputClass}
          />
        </div>

        <div className="flex flex-col gap-2 border-t border-gray-200 pt-4 sm:flex-row-reverse">
          <button
            type="submit"
            disabled={submitting}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-ayira-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-ayira-700 disabled:opacity-60"
          >
            {submitting && <Spinner />}
            Publish gig
          </button>
          <button
            type="button"
            disabled={submitting}
            onClick={(e) => handleSubmit(e, false)}
            className="rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
          >
            Save draft
          </button>
        </div>
      </form>
    </div>
  );
}
