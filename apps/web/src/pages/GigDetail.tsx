import { FormEvent, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { MapPin, Wifi, CalendarClock, Users, BadgeCheck, Send } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useApi } from '@/hooks/useApi';
import { apiFetch } from '@/lib/api';
import {
  Avatar,
  ApplicationStatusBadge,
  EmptyState,
  ErrorMessage,
  GigStatusBadge,
  LoadingBlock,
  SuccessMessage,
  Spinner,
  Tag,
  usePageTitle,
} from '@/components/ui';
import { formatBudgetRange, formatDate, formatRelative, isPastDeadline } from '@/lib/format';
import type { Application, ApplicationListResponse, ApplicationStatus, GigDetail } from '@/types';

const MIN_COVER_LETTER = 20;

export default function GigDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const role = (user?.user_metadata?.role as string) ?? 'worker';

  const gigQuery = useApi<GigDetail>(id ? `/gigs/${id}` : null);
  const applicationsQuery = useApi<ApplicationListResponse>(
    id ? `/applications?gig_id=${id}&limit=100` : null
  );

  const gig = gigQuery.data;
  usePageTitle(gig?.title ?? 'Gig');

  const [actionError, setActionError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  if (gigQuery.loading) return <LoadingBlock label="Loading gig…" />;
  if (gigQuery.error) return <ErrorMessage message={gigQuery.error} onRetry={gigQuery.refetch} />;
  if (!gig) return <ErrorMessage message="Gig not found." />;

  const isOwner = gig.is_owner;
  const applications = applicationsQuery.data?.applications ?? [];
  const myApplication = isOwner ? null : (applications[0] ?? null);
  const canApply =
    !isOwner && role === 'worker' && gig.status === 'open' && !myApplication;

  /** Employer decisions and worker withdrawal share one endpoint. */
  async function updateApplicationStatus(applicationId: string, status: ApplicationStatus) {
    // Accepting also closes the gig and turns down every other applicant.
    if (
      status === 'accepted' &&
      !window.confirm(
        'Accepting this applicant will close the gig and reject all other applications. Continue?'
      )
    ) {
      return;
    }

    setActionError(null);
    setBusyId(applicationId);
    try {
      await apiFetch(`/applications/${applicationId}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      // Accepting moves the gig to in_progress, so both queries are stale.
      applicationsQuery.refetch();
      gigQuery.refetch();
    } catch (err) {
      setActionError((err as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  async function updateGig(action: 'publish' | 'cancel') {
    // Read from the query rather than the narrowed `gig` above: function
    // declarations are hoisted, so that narrowing does not reach in here.
    const current = gigQuery.data;
    if (!current) return;

    setActionError(null);
    setBusyId(action);
    try {
      if (action === 'publish') {
        await apiFetch(`/gigs/${current.id}/publish`, { method: 'PATCH' });
        gigQuery.refetch();
      } else {
        await apiFetch(`/gigs/${current.id}`, { method: 'DELETE' });
        navigate('/app/my-gigs');
      }
    } catch (err) {
      setActionError((err as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-6">
      {/* Gig header */}
      <article className="rounded-lg border border-gray-200 bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="mb-2 flex items-center gap-2">
              <GigStatusBadge status={gig.status} />
              <span className="text-xs text-gray-500">{gig.category}</span>
            </div>
            <h1 className="text-2xl font-bold text-gray-900">{gig.title}</h1>
          </div>
          <span className="text-lg font-semibold text-ayira-700">
            {formatBudgetRange(gig.budget_min, gig.budget_max, gig.currency)}
          </span>
        </div>

        <dl className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm text-gray-600">
          <div className="flex items-center gap-1.5">
            {gig.is_remote ? <Wifi size={15} /> : <MapPin size={15} />}
            <dt className="sr-only">Location</dt>
            <dd>{gig.is_remote ? 'Remote' : (gig.location ?? 'Location not set')}</dd>
          </div>
          <div
            className={`flex items-center gap-1.5 ${
              isPastDeadline(gig.deadline) ? 'text-red-600' : ''
            }`}
          >
            <CalendarClock size={15} />
            <dt className="sr-only">Deadline</dt>
            <dd>
              {gig.deadline
                ? `${formatDate(gig.deadline)} (${formatRelative(gig.deadline)})`
                : 'No deadline'}
            </dd>
          </div>
          {isOwner && gig.application_count !== undefined && (
            <div className="flex items-center gap-1.5">
              <Users size={15} />
              <dt className="sr-only">Applications</dt>
              <dd>
                {gig.application_count}{' '}
                {gig.application_count === 1 ? 'application' : 'applications'}
              </dd>
            </div>
          )}
        </dl>

        <div className="mt-4 whitespace-pre-wrap text-sm leading-relaxed text-gray-700">
          {gig.description}
        </div>

        {gig.required_skills.length > 0 && (
          <div className="mt-4">
            <h2 className="mb-2 text-sm font-medium text-gray-700">Required skills</h2>
            <div className="flex flex-wrap gap-1.5">
              {gig.required_skills.map((skill) => (
                <Tag key={skill}>{skill}</Tag>
              ))}
            </div>
          </div>
        )}
      </article>

      {actionError && <ErrorMessage message={actionError} />}

      {/* Employer profile card */}
      {gig.employer && (
        <section className="rounded-lg border border-gray-200 bg-white p-5">
          <h2 className="mb-3 text-sm font-medium text-gray-700">Posted by</h2>
          <div className="flex items-center gap-3">
            <Avatar name={gig.employer.full_name} src={gig.employer.avatar_url} size={48} />
            <div className="min-w-0 flex-1">
              <Link
                to={`/app/users/${gig.employer.id}`}
                className="flex items-center gap-1.5 font-medium text-gray-900 hover:text-ayira-700"
              >
                {gig.employer.full_name}
                {gig.employer.is_verified && (
                  <BadgeCheck size={16} className="text-ayira-600" aria-label="Verified" />
                )}
              </Link>
              <p className="text-sm text-gray-500">
                {gig.employer_total_gigs} {gig.employer_total_gigs === 1 ? 'gig' : 'gigs'} posted
                {gig.employer.location ? ` · ${gig.employer.location}` : ''}
              </p>
            </div>
          </div>
        </section>
      )}

      {/* Owner controls */}
      {isOwner && (gig.status === 'draft' || gig.status === 'open') && (
        <section className="flex flex-wrap gap-2 rounded-lg border border-gray-200 bg-white p-5">
          {gig.status === 'draft' && (
            <button
              type="button"
              onClick={() => updateGig('publish')}
              disabled={busyId === 'publish'}
              className="inline-flex items-center gap-2 rounded-lg bg-ayira-600 px-4 py-2 text-sm font-medium text-white hover:bg-ayira-700 disabled:opacity-60"
            >
              {busyId === 'publish' && <Spinner />}
              Publish gig
            </button>
          )}
          <button
            type="button"
            onClick={() => updateGig('cancel')}
            disabled={busyId === 'cancel'}
            className="inline-flex items-center gap-2 rounded-lg border border-red-300 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-60"
          >
            {busyId === 'cancel' && <Spinner />}
            Cancel gig
          </button>
        </section>
      )}

      {/* Worker: apply, or track an existing application */}
      {!isOwner && role === 'worker' && (
        <section className="rounded-lg border border-gray-200 bg-white p-5">
          {myApplication ? (
            <>
              <h2 className="mb-3 text-sm font-medium text-gray-700">Your application</h2>
              <div className="flex items-center justify-between gap-3">
                <ApplicationStatusBadge status={myApplication.status} />
                <span className="text-sm text-gray-500">
                  Applied {formatRelative(myApplication.created_at)}
                </span>
              </div>
              {myApplication.cover_letter && (
                <p className="mt-3 whitespace-pre-wrap text-sm text-gray-600">
                  {myApplication.cover_letter}
                </p>
              )}
              {(myApplication.status === 'pending' ||
                myApplication.status === 'shortlisted') && (
                <button
                  type="button"
                  onClick={() => updateApplicationStatus(myApplication.id, 'withdrawn')}
                  disabled={busyId === myApplication.id}
                  className="mt-4 inline-flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-60"
                >
                  {busyId === myApplication.id && <Spinner />}
                  Withdraw application
                </button>
              )}
            </>
          ) : canApply ? (
            <ApplyForm gigId={gig.id} onApplied={applicationsQuery.refetch} />
          ) : (
            <p className="text-sm text-gray-500">
              This gig is no longer accepting applications.
            </p>
          )}
        </section>
      )}

      {/* Employer: applicant list */}
      {isOwner && (
        <section>
          <h2 className="mb-3 text-lg font-semibold">
            Applications{applications.length > 0 && ` (${applications.length})`}
          </h2>

          {applicationsQuery.loading && <LoadingBlock label="Loading applications…" />}
          {applicationsQuery.error && <ErrorMessage message={applicationsQuery.error} />}

          {!applicationsQuery.loading && applications.length === 0 && (
            <EmptyState
              title="No applications yet"
              description={
                gig.status === 'draft'
                  ? 'Publish this gig so workers can find and apply to it.'
                  : 'Workers who apply will show up here.'
              }
            />
          )}

          <div className="space-y-3">
            {applications.map((application) => (
              <ApplicantCard
                key={application.id}
                application={application}
                gigIsOpen={gig.status === 'open'}
                busy={busyId === application.id}
                onDecide={updateApplicationStatus}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function ApplyForm({ gigId, onApplied }: { gigId: string; onApplied: () => void }) {
  const [coverLetter, setCoverLetter] = useState('');
  const [amount, setAmount] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    if (coverLetter.trim().length < MIN_COVER_LETTER) {
      setError(`Your cover letter must be at least ${MIN_COVER_LETTER} characters.`);
      return;
    }
    const proposed = Number(amount);
    if (!amount || !Number.isFinite(proposed) || proposed <= 0) {
      setError('Enter the amount you would like to be paid.');
      return;
    }

    setSubmitting(true);
    try {
      await apiFetch('/applications', {
        method: 'POST',
        body: JSON.stringify({
          gig_id: gigId,
          cover_letter: coverLetter.trim(),
          proposed_amount: proposed,
        }),
      });
      setSubmitted(true);
      onApplied();
    } catch (err) {
      setError((err as Error).message);
      setSubmitting(false);
    }
  }

  if (submitted) return <SuccessMessage message="Your application has been sent." />;

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <h2 className="text-sm font-medium text-gray-700">Apply for this gig</h2>

      {error && <ErrorMessage message={error} />}

      <div>
        <label htmlFor="cover_letter" className="mb-1 block text-sm text-gray-600">
          Why are you a good fit?
        </label>
        <textarea
          id="cover_letter"
          rows={5}
          value={coverLetter}
          onChange={(e) => setCoverLetter(e.target.value)}
          placeholder="Describe relevant experience and how you would approach this work."
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-ayira-500 focus:outline-none focus:ring-1 focus:ring-ayira-500"
        />
        <p className="mt-1 text-xs text-gray-400">
          {coverLetter.trim().length}/{MIN_COVER_LETTER} characters minimum
        </p>
      </div>

      <div>
        <label htmlFor="proposed_amount" className="mb-1 block text-sm text-gray-600">
          Your proposed amount (KES)
        </label>
        <input
          id="proposed_amount"
          type="number"
          min={1}
          step={100}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-ayira-500 focus:outline-none focus:ring-1 focus:ring-ayira-500"
        />
      </div>

      <button
        type="submit"
        disabled={submitting}
        className="inline-flex items-center gap-2 rounded-lg bg-ayira-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-ayira-700 disabled:opacity-60"
      >
        {submitting ? <Spinner /> : <Send size={16} />}
        Submit application
      </button>
    </form>
  );
}

/* -------------------------------------------------------------------------- */

function ApplicantCard({
  application,
  gigIsOpen,
  busy,
  onDecide,
}: {
  application: Application;
  gigIsOpen: boolean;
  busy: boolean;
  onDecide: (id: string, status: ApplicationStatus) => void;
}) {
  const worker = application.worker;
  const decidable =
    gigIsOpen && (application.status === 'pending' || application.status === 'shortlisted');

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex items-start gap-3">
        <Avatar name={worker?.full_name ?? 'Applicant'} src={worker?.avatar_url} size={40} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            {worker ? (
              <Link
                to={`/app/users/${worker.id}`}
                className="font-medium text-gray-900 hover:text-ayira-700"
              >
                {worker.full_name}
              </Link>
            ) : (
              <span className="font-medium text-gray-900">Applicant</span>
            )}
            <ApplicationStatusBadge status={application.status} />
          </div>

          <p className="mt-0.5 text-xs text-gray-500">
            Applied {formatRelative(application.created_at)}
            {application.proposed_amount !== null &&
              ` · asking ${formatBudgetRange(application.proposed_amount, application.proposed_amount)}`}
          </p>

          {worker && worker.skills.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {worker.skills.slice(0, 6).map((skill) => (
                <Tag key={skill}>{skill}</Tag>
              ))}
            </div>
          )}

          {application.cover_letter && (
            <p className="mt-2 whitespace-pre-wrap text-sm text-gray-600">
              {application.cover_letter}
            </p>
          )}

          {decidable && (
            <div className="mt-3 flex flex-wrap gap-2">
              {application.status === 'pending' && (
                <button
                  type="button"
                  onClick={() => onDecide(application.id, 'shortlisted')}
                  disabled={busy}
                  className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-60"
                >
                  Shortlist
                </button>
              )}
              <button
                type="button"
                onClick={() => onDecide(application.id, 'accepted')}
                disabled={busy}
                className="inline-flex items-center gap-1.5 rounded-lg bg-ayira-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-ayira-700 disabled:opacity-60"
              >
                {busy && <Spinner />}
                Accept
              </button>
              <button
                type="button"
                onClick={() => onDecide(application.id, 'rejected')}
                disabled={busy}
                className="rounded-lg border border-red-300 px-3 py-1.5 text-sm text-red-700 hover:bg-red-50 disabled:opacity-60"
              >
                Reject
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
