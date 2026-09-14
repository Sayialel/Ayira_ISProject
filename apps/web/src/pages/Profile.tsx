import { FormEvent, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { BadgeCheck, ExternalLink } from 'lucide-react';
import { useApi } from '@/hooks/useApi';
import { apiFetch } from '@/lib/api';
import SkillsInput from '@/components/SkillsInput';
import {
  Avatar,
  ErrorMessage,
  LoadingBlock,
  Spinner,
  SuccessMessage,
  usePageTitle,
} from '@/components/ui';
import type { SkillCategory, UserProfile } from '@/types';

const MAX_BIO = 500;

export default function Profile() {
  usePageTitle('My profile');

  const { data: profile, loading, error, refetch } = useApi<UserProfile>('/workers/profile');
  const { data: categories } = useApi<SkillCategory[]>('/gigs/meta/categories');

  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [bio, setBio] = useState('');
  const [location, setLocation] = useState('');
  const [skills, setSkills] = useState<string[]>([]);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // Seed the form once the profile arrives.
  useEffect(() => {
    if (!profile) return;
    setFullName(profile.full_name ?? '');
    setPhone(profile.phone ?? '');
    setBio(profile.bio ?? '');
    setLocation(profile.location ?? '');
    setSkills(profile.skills ?? []);
  }, [profile]);

  const suggestions = (categories ?? []).flatMap((c) => c.skills);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSaveError(null);
    setSaved(false);

    if (fullName.trim().length < 2) {
      setSaveError('Enter your full name.');
      return;
    }
    if (phone.trim() && phone.trim().length < 10) {
      setSaveError('Enter a valid phone number.');
      return;
    }
    if (bio.length > MAX_BIO) {
      setSaveError(`Your bio must be ${MAX_BIO} characters or fewer.`);
      return;
    }

    setSaving(true);
    try {
      await apiFetch<UserProfile>('/workers/profile', {
        method: 'PATCH',
        body: JSON.stringify({
          full_name: fullName.trim(),
          ...(phone.trim() && { phone: phone.trim() }),
          bio: bio.trim(),
          location: location.trim(),
          skills,
        }),
      });
      setSaved(true);
      refetch();
    } catch (err) {
      setSaveError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <LoadingBlock label="Loading your profile…" />;
  if (error) return <ErrorMessage message={error} onRetry={refetch} />;
  if (!profile) return <ErrorMessage message="Profile not found." />;

  const inputClass =
    'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-ayira-500 focus:outline-none focus:ring-1 focus:ring-ayira-500';

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-6 flex items-center gap-4">
        <Avatar name={profile.full_name} src={profile.avatar_url} size={64} />
        <div className="min-w-0 flex-1">
          <h1 className="flex items-center gap-1.5 text-2xl font-bold">
            {profile.full_name}
            {profile.is_verified && (
              <BadgeCheck size={20} className="text-ayira-600" aria-label="Verified" />
            )}
          </h1>
          <p className="text-sm capitalize text-gray-500">
            {profile.role} · rating {Number(profile.reputation_score ?? 0).toFixed(2)}
          </p>
        </div>
        <Link
          to={`/app/users/${profile.id}`}
          className="inline-flex shrink-0 items-center gap-1 text-sm text-ayira-700 hover:underline"
        >
          Public view
          <ExternalLink size={14} />
        </Link>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        {saveError && <ErrorMessage message={saveError} />}
        {saved && <SuccessMessage message="Your profile has been updated." />}

        <div>
          <label htmlFor="full_name" className="mb-1 block text-sm font-medium text-gray-700">
            Full name
          </label>
          <input
            id="full_name"
            type="text"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            className={inputClass}
          />
        </div>

        <div>
          <label htmlFor="email" className="mb-1 block text-sm font-medium text-gray-700">
            Email
          </label>
          <input
            id="email"
            type="email"
            value={profile.email ?? ''}
            disabled
            className={`${inputClass} bg-gray-50 text-gray-500`}
          />
          <p className="mt-1 text-xs text-gray-400">
            Your email is managed by your sign-in account.
          </p>
        </div>

        <div>
          <label htmlFor="phone" className="mb-1 block text-sm font-medium text-gray-700">
            Phone
          </label>
          <input
            id="phone"
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="e.g. 0712345678"
            className={inputClass}
          />
        </div>

        <div>
          <label htmlFor="location" className="mb-1 block text-sm font-medium text-gray-700">
            Location
          </label>
          <input
            id="location"
            type="text"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="e.g. Nairobi"
            className={inputClass}
          />
          <p className="mt-1 text-xs text-gray-400">
            Matching gives a small boost to gigs in your location.
          </p>
        </div>

        <div>
          <label htmlFor="bio" className="mb-1 block text-sm font-medium text-gray-700">
            Bio
          </label>
          <textarea
            id="bio"
            rows={5}
            maxLength={MAX_BIO}
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            placeholder="Tell employers about your experience and the work you do best."
            className={inputClass}
          />
          <p className="mt-1 text-xs text-gray-400">
            {bio.length}/{MAX_BIO} characters
          </p>
        </div>

        <div>
          <label htmlFor="skills" className="mb-1 block text-sm font-medium text-gray-700">
            Skills
          </label>
          <SkillsInput
            id="skills"
            value={skills}
            onChange={setSkills}
            suggestions={suggestions}
            max={30}
          />
          <p className="mt-2 text-xs text-gray-400">
            Your skills and bio are what the AI matcher scores gigs against.
          </p>
        </div>

        <button
          type="submit"
          disabled={saving}
          className="inline-flex items-center gap-2 rounded-lg bg-ayira-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-ayira-700 disabled:opacity-60"
        >
          {saving && <Spinner />}
          Save changes
        </button>
      </form>
    </div>
  );
}
