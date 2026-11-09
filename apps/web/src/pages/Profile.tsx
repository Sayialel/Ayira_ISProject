import { FormEvent, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  BadgeCheck,
  Briefcase,
  CheckCircle2,
  Circle,
  ExternalLink,
  MapPin,
  Phone,
  Star,
  UserRound,
  Upload,
  Wrench,
} from 'lucide-react';
import { useApi } from '@/hooks/useApi';
import { apiFetch } from '@/lib/api';
import SkillsInput from '@/components/SkillsInput';
import CvImport from '@/components/CvImport';
import ProgressRing, { profileCompletion } from '@/components/ProgressRing';
import { ShukaWeave } from '@/components/patterns';
import {
  Avatar,
  Card,
  ErrorMessage,
  LoadingBlock,
  Spinner,
  SuccessMessage,
  Tag,
  inputClass,
  usePageTitle,
} from '@/components/ui';
import type { SkillCategory, UserProfile } from '@/types';

const MAX_BIO = 500;

type TabKey = 'overview' | 'about' | 'skills' | 'account';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'about', label: 'About you' },
  { key: 'skills', label: 'Skills' },
  { key: 'account', label: 'Account' },
];

/**
 * The account holder's own profile.
 *
 * Laid out as a summary header over tabbed sections rather than one long
 * form. The header answers "how am I presented and what is missing", which is
 * what someone opens this page to find out; the tabs hold the editing, which
 * is what they do about it. A single scrolling form made the completeness of
 * the profile invisible -- the thing the matcher depends on most.
 */
export default function Profile() {
  usePageTitle('My profile');

  const { data: profile, loading, error, refetch } = useApi<UserProfile>('/workers/profile');
  const { data: categories } = useApi<SkillCategory[]>('/gigs/meta/categories');

  const [tab, setTab] = useState<TabKey>('overview');

  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [bio, setBio] = useState('');
  const [location, setLocation] = useState('');
  const [skills, setSkills] = useState<string[]>([]);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [importing, setImporting] = useState(false);

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

  // An administrator is staff, not a participant: they are never matched to a
  // gig and never reviewed, so the parts of this page about being hireable do
  // not apply to them.
  const isStaff = profile?.role === 'admin';

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

  // Measured from the saved profile, not the unsaved form, so the ring never
  // claims credit for text that has not been stored yet.
  const completion = profileCompletion(profile);
  const missing = completion.items.filter((i) => !i.done);

  return (
    <div className="space-y-5">
      {/* ---------------------------------------------------------------- */}
      {/* Header: who you are, and what is missing                         */}
      {/* ---------------------------------------------------------------- */}
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
        <Card className="overflow-hidden p-5 sm:p-6">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
            {/* The tinted tile, rather than a bare circle: it gives the photo
                somewhere to sit and keeps the header from starting on text. */}
            <div className="flex h-24 w-24 shrink-0 items-center justify-center rounded-2xl bg-ayira-50 ring-1 ring-ayira-100 sm:h-28 sm:w-28">
              <Avatar name={profile.full_name} src={profile.avatar_url} size={76} />
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h1 className="flex items-center gap-1.5 font-display text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
                    <span className="truncate">{profile.full_name}</span>
                    {profile.is_verified && (
                      <BadgeCheck
                        size={20}
                        className="shrink-0 text-ayira-600"
                        aria-label="Verified"
                      />
                    )}
                  </h1>

                  <div className="mt-1.5 flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold capitalize text-slate-600">
                      {isStaff ? 'Administrator' : profile.role}
                    </span>
                    {profile.is_verified ? (
                      <span className="rounded-full bg-acacia-50 px-2.5 py-1 text-xs font-semibold text-acacia-700">
                        Verified
                      </span>
                    ) : (
                      <span className="rounded-full bg-gold-50 px-2.5 py-1 text-xs font-semibold text-gold-700">
                        Not verified
                      </span>
                    )}
                  </div>
                </div>

                {/* Staff have no completion target: nothing here feeds a
                    matcher they are never part of. */}
                {!isStaff && (
                  <div className="flex items-center gap-3">
                    <ProgressRing
                      value={completion.percent}
                      label={`Profile ${completion.percent}% complete`}
                    />
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-900">
                        {completion.percent === 100
                          ? 'Profile complete'
                          : 'Complete your profile'}
                      </p>
                      <p className="text-xs text-slate-500">
                        {completion.percent === 100
                          ? 'Everything the matcher reads is filled in.'
                          : `${missing.length} ${missing.length === 1 ? 'item' : 'items'} left`}
                      </p>
                    </div>
                  </div>
                )}
              </div>

              <ShukaWeave className="mt-4 w-full rounded-full" height={4} />

              {/* The facts, as tiles. Each one is read from the stored row. */}
              <dl className="mt-4 grid gap-3 sm:grid-cols-3">
                <FactTile
                  icon={<MapPin size={14} aria-hidden />}
                  label="Location"
                  value={profile.location || null}
                />
                <FactTile
                  icon={<Phone size={14} aria-hidden />}
                  label="Phone"
                  value={profile.phone || null}
                />
                {isStaff ? (
                  <FactTile
                    icon={<Briefcase size={14} aria-hidden />}
                    label="Account type"
                    value="Platform staff"
                  />
                ) : (
                  <FactTile
                    icon={<Star size={14} aria-hidden />}
                    label="Rating"
                    // reputation_score is 0.00 only when nobody has reviewed
                    // yet: 0 is unreachable on a 1-5 review scale, so it is a
                    // safe stand-in for a review count this endpoint does not
                    // return. The public profile shows the count itself.
                    value={
                      Number(profile.reputation_score ?? 0) > 0
                        ? `${Number(profile.reputation_score).toFixed(2)} out of 5`
                        : null
                    }
                    emptyText="No reviews yet"
                  />
                )}
              </dl>
            </div>
          </div>
        </Card>

        {/* The side card: the single most useful next action. */}
        {!isStaff && <NextStepCard missing={missing} onGo={() => setTab('about')} />}
        {isStaff && <StaffCard />}
      </div>

      {/* ---------------------------------------------------------------- */}
      {/* Import from a CV                                                 */}
      {/* ---------------------------------------------------------------- */}
      {/* Above the tabs on purpose. This is the shortest route from an
          empty profile to a matchable one, and it was previously buried
          inside the Skills tab where a new worker had to go looking for it.
          Prominent while the profile is thin, quiet once it is filled in --
          someone with skills and a bio does not need to be sold this. */}
      {!isStaff && (
        <div
          className={`mb-5 rounded-xl border p-4 sm:p-5 ${
            skills.length === 0 || !bio.trim()
              ? 'border-ayira-200 bg-ayira-50/60'
              : 'border-slate-200 bg-white'
          }`}
        >
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex min-w-0 items-start gap-3">
              <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-ayira-600 text-white">
                <Upload size={18} aria-hidden />
              </span>
              <div className="min-w-0">
                <h2 className="font-display text-base font-bold text-slate-900">
                  {skills.length === 0 || !bio.trim()
                    ? 'Start with your CV'
                    : 'Update from your CV'}
                </h2>
                <p className="mt-1 text-sm text-slate-600">
                  We read it on your device and fill in your skills and About section. Your CV
                  is never uploaded.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setImporting(true)}
              className="shrink-0 rounded-lg bg-ayira-600 px-4 py-2.5 text-sm font-semibold text-white shadow-card transition-all duration-150 hover:bg-ayira-700 hover:shadow-lift active:scale-[0.98]"
            >
              Upload your CV
            </button>
          </div>
        </div>
      )}

      {/* ---------------------------------------------------------------- */}
      {/* Tabs                                                             */}
      {/* ---------------------------------------------------------------- */}
      <div className="overflow-x-auto">
        <div
          role="tablist"
          aria-label="Profile sections"
          className="inline-flex gap-1 rounded-xl bg-slate-100 p-1"
        >
          {TABS.filter((t) => !(isStaff && t.key === 'skills')).map((t) => (
            <button
              key={t.key}
              role="tab"
              aria-selected={tab === t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`whitespace-nowrap rounded-lg px-4 py-2 text-sm font-medium transition-all ${
                tab === t.key
                  ? 'bg-white text-slate-900 shadow-card'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {saveError && <ErrorMessage message={saveError} />}
      {saved && <SuccessMessage message="Your profile has been updated." />}

      {/* ---------------------------------------------------------------- */}
      {/* Panels                                                           */}
      {/* ---------------------------------------------------------------- */}
      {tab === 'overview' && (
        <div className="grid gap-5 md:grid-cols-2">
          <PanelCard
            icon={<UserRound size={18} aria-hidden />}
            title="About"
            action={
              <button
                type="button"
                onClick={() => setTab('about')}
                className="text-sm font-semibold text-ayira-700 hover:underline"
              >
                View &amp; edit
              </button>
            }
          >
            {profile.bio ? (
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
                {profile.bio}
              </p>
            ) : (
              <Empty text="You have not written anything about yourself yet. The matcher reads this." />
            )}
          </PanelCard>

          {!isStaff && (
            <PanelCard
              icon={<Wrench size={18} aria-hidden />}
              title="Skills"
              action={
                <button
                  type="button"
                  onClick={() => setTab('skills')}
                  className="text-sm font-semibold text-ayira-700 hover:underline"
                >
                  View &amp; edit
                </button>
              }
            >
              {skills.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {skills.map((s) => (
                    <Tag key={s}>{s}</Tag>
                  ))}
                </div>
              ) : (
                <Empty text="No skills added. This is the strongest signal the matcher uses." />
              )}
            </PanelCard>
          )}
        </div>
      )}

      {tab === 'about' && (
        <form onSubmit={handleSubmit}>
          <PanelCard icon={<UserRound size={18} aria-hidden />} title="About you">
            <div className="space-y-5">
              <div>
                <label
                  htmlFor="full_name"
                  className="mb-1.5 block text-sm font-medium text-slate-700"
                >
                  Full name
                </label>
                <input
                  id="full_name"
                  type="text"
                  autoComplete="name"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className={inputClass}
                />
              </div>

              <div>
                <label
                  htmlFor="location"
                  className="mb-1.5 block text-sm font-medium text-slate-700"
                >
                  Town
                </label>
                <input
                  id="location"
                  type="text"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  placeholder="e.g. Nairobi"
                  className={inputClass}
                />
                <p className="mt-1.5 text-xs text-slate-400">
                  Gigs in your town and county rank slightly higher.
                </p>
              </div>

              <div>
                <label htmlFor="bio" className="mb-1.5 block text-sm font-medium text-slate-700">
                  About you
                </label>
                <textarea
                  id="bio"
                  rows={6}
                  maxLength={MAX_BIO}
                  value={bio}
                  onChange={(e) => setBio(e.target.value)}
                  placeholder="Tell employers about your experience and the work you do best."
                  className={inputClass}
                />
                <p className="mt-1.5 text-xs text-slate-400">
                  {bio.length}/{MAX_BIO} characters · read by the matcher
                </p>
              </div>

              <SaveButton saving={saving} />
            </div>
          </PanelCard>
        </form>
      )}

      {importing && (
        <CvImport
          currentSkills={skills}
          currentBio={bio}
          onClose={() => setImporting(false)}
          onApply={({ skills: found, bio: about }) => {
            setSkills((current) => {
              const have = new Set(current.map((s) => s.toLowerCase()));
              return [...current, ...found.filter((s) => !have.has(s.toLowerCase()))].slice(0, 30);
            });
            if (about) setBio(about);
            setImporting(false);
            setSaved(false);
          }}
        />
      )}

      {tab === 'skills' && !isStaff && (
        <form onSubmit={handleSubmit}>
          <PanelCard icon={<Wrench size={18} aria-hidden />} title="Skills">
            <SkillsInput
              id="skills"
              value={skills}
              onChange={setSkills}
              suggestions={suggestions}
              max={30}
            />
            <p className="mt-2.5 text-xs text-slate-400">
              Your skills and bio are what the AI matcher scores gigs against. Plain
              words beat job titles.
            </p>

            <div className="mt-5">
              <SaveButton saving={saving} />
            </div>
          </PanelCard>
        </form>
      )}

      {tab === 'account' && (
        <form onSubmit={handleSubmit}>
          <PanelCard icon={<BadgeCheck size={18} aria-hidden />} title="Account">
            <div className="space-y-5">
              <div>
                <label htmlFor="email" className="mb-1.5 block text-sm font-medium text-slate-700">
                  Email
                </label>
                <input
                  id="email"
                  type="email"
                  value={profile.email ?? ''}
                  disabled
                  className={inputClass}
                />
                <p className="mt-1.5 text-xs text-slate-400">
                  Managed by your sign-in account, so it cannot be changed here.
                </p>
              </div>

              <div>
                <label htmlFor="phone" className="mb-1.5 block text-sm font-medium text-slate-700">
                  Phone
                </label>
                <input
                  id="phone"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="07XX XXX XXX"
                  className={inputClass}
                />
                <p className="mt-1.5 text-xs text-slate-400">
                  Used for M-Pesa. Any Kenyan format works.
                </p>
              </div>

              {!isStaff && (
                <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4">
                  <p className="text-sm font-medium text-slate-800">Your public profile</p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    This is what employers see before they hire you.
                  </p>
                  <Link
                    to={`/app/users/${profile.id}`}
                    className="mt-2.5 inline-flex items-center gap-1.5 text-sm font-semibold text-ayira-700 hover:underline"
                  >
                    Open public view
                    <ExternalLink size={14} aria-hidden />
                  </Link>
                </div>
              )}

              <SaveButton saving={saving} />
            </div>
          </PanelCard>
        </form>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function SaveButton({ saving }: { saving: boolean }) {
  return (
    <button
      type="submit"
      disabled={saving}
      className="inline-flex items-center justify-center gap-2 rounded-lg bg-ayira-600 px-4 py-2.5 text-sm font-semibold text-white shadow-card transition-all duration-150 hover:bg-ayira-700 hover:shadow-lift active:scale-[0.98] disabled:pointer-events-none disabled:opacity-55"
    >
      {saving && <Spinner />}
      Save changes
    </button>
  );
}

/** One stored fact. Says "not set" rather than rendering a blank. */
function FactTile({
  icon,
  label,
  value,
  emptyText = 'Not set',
}: {
  icon: React.ReactNode;
  label: string;
  value: string | null;
  emptyText?: string;
}) {
  return (
    <div className="rounded-xl bg-slate-50 px-3.5 py-3 ring-1 ring-slate-100">
      <dt className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
        {icon}
        {label}
      </dt>
      <dd
        className={`mt-1 truncate text-sm font-semibold ${
          value ? 'text-slate-900' : 'text-slate-400'
        }`}
      >
        {value ?? emptyText}
      </dd>
    </div>
  );
}

/**
 * The checklist, as the side card.
 *
 * A percentage on its own cannot be acted on. Listing the missing items names
 * the next thing to do, and the one-line reasons say why it is worth doing.
 */
function NextStepCard({
  missing,
  onGo,
}: {
  missing: { label: string; done: boolean; hint?: string }[];
  onGo: () => void;
}) {
  const complete = missing.length === 0;

  return (
    <Card className="flex flex-col p-5 sm:p-6">
      <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-gold-50 text-gold-700 ring-1 ring-gold-100">
        {complete ? <CheckCircle2 size={19} aria-hidden /> : <Star size={19} aria-hidden />}
      </div>

      <h2 className="font-display text-lg font-bold text-slate-900">
        {complete ? 'Nothing left to add' : 'Get matched to better gigs'}
      </h2>
      <p className="mt-1 text-sm leading-relaxed text-slate-600">
        {complete
          ? 'Your profile has everything the matcher reads. Reviews build the rest over time.'
          : 'The matcher ranks gigs against what you write here. These are still empty:'}
      </p>

      {!complete && (
        <ul className="mt-3 space-y-2">
          {missing.map((item) => (
            <li key={item.label} className="flex items-start gap-2 text-sm">
              <Circle size={14} className="mt-0.5 shrink-0 text-slate-300" aria-hidden />
              <span>
                <span className="font-medium text-slate-800">{item.label}</span>
                {item.hint && (
                  <span className="block text-xs text-slate-500">{item.hint}</span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}

      {!complete && (
        <button
          type="button"
          onClick={onGo}
          className="mt-auto inline-flex w-full items-center justify-center gap-2 rounded-lg bg-ayira-600 px-4 py-2.5 pt-2.5 text-sm font-semibold text-white shadow-card transition-all duration-150 hover:bg-ayira-700 hover:shadow-lift active:scale-[0.98]"
          style={{ marginTop: 'auto' }}
        >
          Fill these in
        </button>
      )}
    </Card>
  );
}

function StaffCard() {
  return (
    <Card className="p-5 sm:p-6">
      <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-ayira-50 text-ayira-700 ring-1 ring-ayira-100">
        <BadgeCheck size={19} aria-hidden />
      </div>
      <h2 className="font-display text-lg font-bold text-slate-900">Platform staff</h2>
      <p className="mt-1 text-sm leading-relaxed text-slate-600">
        Administrator accounts are not matched to gigs and are not reviewed, so there
        is no public profile and no rating to build.
      </p>
      <Link
        to="/app/admin"
        className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-ayira-700 hover:underline"
      >
        Go to the admin overview
        <ExternalLink size={14} aria-hidden />
      </Link>
    </Card>
  );
}

function PanelCard({
  icon,
  title,
  action,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Card className="p-5 sm:p-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2.5 font-display text-lg font-bold text-slate-900">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-ayira-50 text-ayira-700 ring-1 ring-ayira-100">
            {icon}
          </span>
          {title}
        </h2>
        {action}
      </div>
      {children}
    </Card>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="text-sm text-slate-400">{text}</p>;
}
