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
  location?: boolean;
  reputation?: number;
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
