/** Shapes returned by the Ayira API gateway. Mirrors apps/api/src/types/database.ts. */

export type UserRole = 'worker' | 'employer' | 'admin';

export type GigStatus = 'draft' | 'open' | 'in_progress' | 'completed' | 'cancelled';

export type ApplicationStatus =
  | 'pending'
  | 'shortlisted'
  | 'accepted'
  | 'rejected'
  | 'withdrawn';

export interface EmployerSummary {
  id: string;
  full_name: string;
  avatar_url: string | null;
  reputation_score?: number;
  is_verified?: boolean;
  location?: string | null;
}

export interface Gig {
  id: string;
  employer_id: string;
  title: string;
  description: string;
  category: string;
  required_skills: string[];
  location: string | null;
  is_remote: boolean;
  budget_min: number | null;
  budget_max: number | null;
  currency: string;
  deadline: string | null;
  status: GigStatus;
  created_at: string;
  updated_at: string;
  employer?: EmployerSummary | null;
  /** Only present when an employer lists their own gigs. */
  application_count?: number;
}

export interface GigDetail extends Gig {
  employer_total_gigs: number;
  application_count?: number;
  is_owner: boolean;
}

export interface WorkerSummary {
  id: string;
  full_name: string;
  avatar_url: string | null;
  skills: string[];
  location: string | null;
  reputation_score: number;
  is_verified: boolean;
}

export interface Application {
  id: string;
  gig_id: string;
  worker_id: string;
  cover_letter: string | null;
  proposed_amount: number | null;
  ai_match_score: number | null;
  status: ApplicationStatus;
  created_at: string;
  updated_at: string;
  gig?: Gig | null;
  worker?: WorkerSummary | null;
}

export interface UserProfile {
  id: string;
  email?: string;
  full_name: string;
  phone?: string | null;
  role: UserRole;
  /**
   * False after an OAuth signup, until the person picks a role. Optional so a
   * response from a server predating migration 023 is treated as chosen
   * rather than trapping the session at the chooser.
   */
  role_confirmed?: boolean;
  avatar_url: string | null;
  bio: string | null;
  skills: string[];
  location: string | null;
  reputation_score: number;
  is_verified: boolean;
  created_at: string;
}

export interface PublicProfileData extends UserProfile {
  completed_gigs: number;
  total_reviews: number;
}

export type EscrowStatus =
  | 'pending'
  | 'funded'
  | 'released'
  | 'disputed'
  | 'refunded'
  | 'partial_release'
  | 'cancelled';

export interface EscrowEvent {
  id: string;
  from_status: string | null;
  to_status: string;
  detail: string | null;
  created_at: string;
}

export interface Escrow {
  id: string;
  gig_id: string;
  employer_id: string;
  worker_id: string;
  amount: number;
  currency: string;
  mpesa_checkout_id: string | null;
  mpesa_receipt: string | null;
  status: EscrowStatus;
  funded_at: string | null;
  released_at: string | null;
  /**
   * What the worker was paid: equal to `amount` on a full release, less than
   * it on a split, and null while nothing has been paid out. The employer's
   * refund on a split is `amount - released_amount`.
   */
  released_amount: number | null;
  created_at: string;
  gig?: { id: string; title: string; status: GigStatus } | null;
  employer?: { id: string; full_name: string; avatar_url: string | null } | null;
  worker?: { id: string; full_name: string; avatar_url: string | null } | null;
  events?: EscrowEvent[];
}

export interface EscrowListResponse extends Paginated {
  escrow: Escrow[];
  /** False when the server has no Daraja credentials, so funding is unavailable. */
  mpesa_configured: boolean;
}

export interface FundResponse {
  escrow_id: string;
  checkout_request_id: string;
  amount: number;
  message: string;
}

export interface SkillCategory {
  id: string;
  name: string;
  skills: string[];
}

export interface Paginated {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface GigListResponse extends Paginated {
  gigs: Gig[];
}

export interface ApplicationListResponse extends Paginated {
  applications: Application[];
}

export interface WorkerStats {
  role: 'worker';
  total_applications: number;
  active_gigs: number;
  completed_gigs: number;
  average_rating: number;
  total_reviews: number;
  total_earnings: number;
}

export interface EmployerStats {
  role: 'employer';
  total_gigs: number;
  open_gigs: number;
  active_gigs: number;
  completed_gigs: number;
  total_applicants: number;
  escrow_held: number;
  total_paid_out: number;
}

export type DashboardStats = WorkerStats | EmployerStats;

export interface MatchBreakdown {
  semantic?: number;
  tfidf?: number;
  /** Location affinity 0-1, not a yes/no: see scoring.location_affinity. */
  location?: number;
  /** The employer's reputation on the 0-5 review scale, not the worker's. */
  employer_reputation?: number;
}

export interface GigMatch {
  gig: Gig;
  score: number;
  score_percent: number;
  breakdown: MatchBreakdown;
}

export interface MatchResponse {
  matches: GigMatch[];
  generated_at: string;
}

// --- Admin ---------------------------------------------------------------
//
// Only the admin router returns these. The UI gate on them is cosmetic:
// `user_metadata.role` is user-editable in Supabase, so the real boundary is
// the gateway, which resolves the role from the users table and never
// escalates to admin from a token claim. A non-admin reaching these pages
// gets a 403 rather than data.

export interface AdminDashboardStats {
  total_users: number;
  total_workers: number;
  total_employers: number;
  /** Staff accounts, so the three role counts add up to total_users. */
  total_admins: number;
  total_gigs: number;
  open_gigs: number;
  in_progress_gigs: number;
  completed_gigs: number;
  cancelled_gigs: number;
  total_applications: number;
  active_escrow_amount: number;
  total_released_amount: number;
  /** Disputes waiting on an administrator — a queue, not a statistic. */
  disputed_escrow_count: number;
  total_platform_revenue: number;
}

export interface AdminUserListResponse extends Paginated {
  users: UserProfile[];
}

export interface AdminGig extends Gig {
  employer: EmployerSummary | null;
}

export interface AdminGigListResponse extends Paginated {
  gigs: AdminGig[];
}

// --- Reviews -------------------------------------------------------------
//
// Reviews are only writable on a completed gig, between the employer and the
// worker they hired. The database enforces that; these are the shapes the
// gateway returns.

export interface ReviewReviewer {
  id: string;
  full_name: string;
  avatar_url: string | null;
  role: UserRole;
}

export interface Review {
  id: string;
  gig_id: string;
  reviewer_id: string;
  reviewee_id: string;
  rating: number;
  comment: string | null;
  created_at: string;
  reviewer: ReviewReviewer | null;
  gig: { id: string; title: string; category: string } | null;
}

export interface ReviewListResponse extends Paginated {
  reviews: Review[];
  /** Averaged over the returned page only; reputation_score is authoritative. */
  average_on_page: number | null;
}

/** A completed gig the caller still owes a review on. */
export interface PendingReview {
  gig_id: string;
  title: string;
  reviewee_id: string;
  role: string;
}

// --- Admin escrow --------------------------------------------------------

export interface EscrowParty {
  id: string;
  full_name: string;
  email?: string;
  avatar_url: string | null;
}

export interface AdminEscrow extends Escrow {
  gig: { id: string; title: string; status: GigStatus; category: string } | null;
  employer: EscrowParty | null;
  worker: EscrowParty | null;
}

export interface AdminEscrowListResponse extends Paginated {
  escrow: AdminEscrow[];
  /** Surfaced separately so the UI can lead with what needs a decision. */
  disputed_count: number;
}

export interface EscrowEventRow {
  id: string;
  from_status: EscrowStatus | null;
  to_status: EscrowStatus;
  actor_id: string | null;
  detail: string | null;
  created_at: string;
  actor: { id: string; full_name: string; role: UserRole } | null;
}

export interface AdminEscrowDetail {
  escrow: AdminEscrow;
  events: EscrowEventRow[];
}
