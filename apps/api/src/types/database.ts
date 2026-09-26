// Database types for the Ayira Supabase schema.
//
// These are maintained by hand to mirror supabase/migrations/001..010.
// Run `npm run db:types` once the project is linked to regenerate them.

export type UserRole = 'worker' | 'employer' | 'admin';

export type GigStatus = 'draft' | 'open' | 'in_progress' | 'completed' | 'cancelled';

export type ApplicationStatus =
  | 'pending'
  | 'shortlisted'
  | 'accepted'
  | 'rejected'
  | 'withdrawn';

export type EscrowStatus =
  | 'pending'
  | 'funded'
  | 'released'
  | 'disputed'
  | 'refunded'
  | 'partial_release'
  | 'cancelled';

export type UserRow = {
  id: string;
  email: string;
  full_name: string;
  phone: string | null;
  role: UserRole;
  avatar_url: string | null;
  bio: string | null;
  skills: string[];
  location: string | null;
  reputation_score: number;
  is_verified: boolean;
  created_at: string;
  updated_at: string;
}

export type GigRow = {
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
}

export type ApplicationRow = {
  id: string;
  gig_id: string;
  worker_id: string;
  cover_letter: string | null;
  proposed_amount: number | null;
  ai_match_score: number | null;
  status: ApplicationStatus;
  created_at: string;
  updated_at: string;
}

export type EscrowRow = {
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
  created_at: string;
  updated_at: string;
}

export type ReviewRow = {
  id: string;
  gig_id: string;
  reviewer_id: string;
  reviewee_id: string;
  rating: number;
  comment: string | null;
  created_at: string;
}

export type NotificationRow = {
  id: string;
  user_id: string;
  type: string;
  title: string;
  body: string | null;
  data: Record<string, unknown>;
  is_read: boolean;
  created_at: string;
}

export type MessageRow = {
  id: string;
  gig_id: string | null;
  sender_id: string;
  receiver_id: string;
  content: string;
  is_read: boolean;
  created_at: string;
}

export type AiMatchLogRow = {
  id: string;
  worker_id: string;
  gig_id: string;
  semantic_score: number | null;
  tfidf_score: number | null;
  location_match: boolean | null;
  composite_score: number | null;
  created_at: string;
}

export type SkillCategoryRow = {
  id: string;
  name: string;
  skills: string[];
  created_at: string;
}


/**
 * An insert payload: the columns Postgres cannot fill in for us are required,
 * everything else (primary keys, timestamps, and any column with a DEFAULT)
 * is optional.
 */
type Insertable<T, RequiredKeys extends keyof T> = Pick<T, RequiredKeys> &
  Partial<Omit<T, RequiredKeys>>;

/**
 * Foreign keys, named the way Postgres auto-names inline REFERENCES
 * constraints (<table>_<column>_fkey). These names are what PostgREST accepts
 * as disambiguation hints in embedded selects, e.g.
 * `employer:users!gigs_employer_id_fkey(...)`, which is required wherever a
 * table points at `users` more than once.
 */
type FkTo<Name extends string, Column extends string, Target extends string> = {
  foreignKeyName: Name;
  columns: [Column];
  isOneToOne: false;
  referencedRelation: Target;
  referencedColumns: ['id'];
};

export interface Database {
  public: {
    Tables: {
      users: {
        Row: UserRow;
        // users.id is the auth.users id, so it is supplied rather than generated.
        Insert: Insertable<UserRow, 'id' | 'email' | 'full_name'>;
        Update: Partial<Omit<UserRow, 'id'>>;
        Relationships: [];
      };
      gigs: {
        Row: GigRow;
        Insert: Insertable<GigRow, 'employer_id' | 'title' | 'description' | 'category'>;
        Update: Partial<Omit<GigRow, 'id' | 'employer_id'>>;
        Relationships: [FkTo<'gigs_employer_id_fkey', 'employer_id', 'users'>];
      };
      applications: {
        Row: ApplicationRow;
        Insert: Insertable<ApplicationRow, 'gig_id' | 'worker_id'>;
        Update: Partial<Omit<ApplicationRow, 'id' | 'gig_id' | 'worker_id'>>;
        Relationships: [
          FkTo<'applications_gig_id_fkey', 'gig_id', 'gigs'>,
          FkTo<'applications_worker_id_fkey', 'worker_id', 'users'>,
        ];
      };
      escrow: {
        Row: EscrowRow;
        Insert: Insertable<EscrowRow, 'gig_id' | 'employer_id' | 'worker_id' | 'amount'>;
        Update: Partial<Omit<EscrowRow, 'id' | 'gig_id'>>;
        Relationships: [
          FkTo<'escrow_gig_id_fkey', 'gig_id', 'gigs'>,
          FkTo<'escrow_employer_id_fkey', 'employer_id', 'users'>,
          FkTo<'escrow_worker_id_fkey', 'worker_id', 'users'>,
        ];
      };
      reviews: {
        Row: ReviewRow;
        Insert: Insertable<ReviewRow, 'gig_id' | 'reviewer_id' | 'reviewee_id' | 'rating'>;
        Update: Partial<Omit<ReviewRow, 'id'>>;
        Relationships: [
          FkTo<'reviews_gig_id_fkey', 'gig_id', 'gigs'>,
          FkTo<'reviews_reviewer_id_fkey', 'reviewer_id', 'users'>,
          FkTo<'reviews_reviewee_id_fkey', 'reviewee_id', 'users'>,
        ];
      };
      notifications: {
        Row: NotificationRow;
        Insert: Insertable<NotificationRow, 'user_id' | 'type' | 'title'>;
        Update: Partial<Omit<NotificationRow, 'id'>>;
        Relationships: [FkTo<'notifications_user_id_fkey', 'user_id', 'users'>];
      };
      messages: {
        Row: MessageRow;
        Insert: Insertable<MessageRow, 'sender_id' | 'receiver_id' | 'content'>;
        Update: Partial<Omit<MessageRow, 'id'>>;
        Relationships: [
          FkTo<'messages_gig_id_fkey', 'gig_id', 'gigs'>,
          FkTo<'messages_sender_id_fkey', 'sender_id', 'users'>,
          FkTo<'messages_receiver_id_fkey', 'receiver_id', 'users'>,
        ];
      };
      ai_match_logs: {
        Row: AiMatchLogRow;
        Insert: Insertable<AiMatchLogRow, 'worker_id' | 'gig_id'>;
        Update: Partial<Omit<AiMatchLogRow, 'id'>>;
        Relationships: [
          FkTo<'ai_match_logs_worker_id_fkey', 'worker_id', 'users'>,
          FkTo<'ai_match_logs_gig_id_fkey', 'gig_id', 'gigs'>,
        ];
      };
      skill_categories: {
        Row: SkillCategoryRow;
        Insert: Insertable<SkillCategoryRow, 'name'>;
        Update: Partial<Omit<SkillCategoryRow, 'id'>>;
        Relationships: [];
      };
    };
    Views: Record<never, never>;
    Functions: {
      /**
       * Hires an applicant in one transaction: marks the application accepted,
       * moves the gig to in_progress and rejects the remaining applicants.
       * Defined in migration 012 and executable only by the service role.
       */
      accept_application: {
        Args: { p_application_id: string };
        Returns: ApplicationRow;
      };
    };
  };
}
