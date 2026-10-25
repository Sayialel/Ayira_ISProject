import { Link } from 'react-router-dom';
import {
  ArrowRight,
  BadgeCheck,
  Banknote,
  Handshake,
  MapPin,
  ScanSearch,
  ShieldCheck,
  Sparkles,
  Star,
} from 'lucide-react';
import { AyiraMark, BeadBand, MudclothField, ShukaWeave } from '@/components/patterns';
import { usePageTitle } from '@/components/ui';

/**
 * The public face of Ayira: what it does, who it is for, and how to join.
 *
 * Deliberately one page. Someone arriving from a shared link wants to know
 * what this is and whether to sign up, and splitting six paragraphs across
 * five routes only adds clicks between them and that decision.
 *
 * The visual language is Kenyan textile -- shuka red, savanna ochre, beadwork
 * bands -- because the platform is for Kenyan workers and a generic SaaS blue
 * says nothing about who it is for. See components/patterns.tsx.
 */
export default function Landing() {
  usePageTitle('Ayira — find work that fits your skills');

  return (
    <div className="min-h-screen bg-slate-50">
      <SiteHeader />
      <Hero />
      <WhatItIs />
      <HowItWorks />
      <Protection />
      <JoinCta />
      <SiteFooter />
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function SiteHeader() {
  return (
    <header className="sticky top-0 z-30 border-b border-slate-200/80 bg-slate-50/90 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-3">
        <Link to="/" className="flex items-center gap-2.5">
          <AyiraMark size={30} />
          <span className="font-display text-xl font-bold tracking-tight text-slate-900">
            Ayira
          </span>
        </Link>

        <nav className="flex items-center gap-1 sm:gap-2">
          <a
            href="#how"
            className="hidden rounded-lg px-3 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 sm:block"
          >
            How it works
          </a>
          <Link
            to="/signin"
            className="rounded-lg px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100"
          >
            Sign in
          </Link>
          <Link
            to="/signup"
            className="inline-flex items-center gap-1.5 rounded-lg bg-ayira-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-all hover:bg-ayira-700 hover:shadow-lift active:scale-[0.98]"
          >
            Join free
          </Link>
        </nav>
      </div>
    </header>
  );
}

function Hero() {
  return (
    <section className="relative overflow-hidden border-b border-slate-200 bg-gradient-to-b from-ayira-50/70 via-slate-50 to-slate-50">
      <MudclothField />

      <div className="relative mx-auto grid max-w-6xl items-center gap-10 px-5 py-16 sm:py-20 lg:grid-cols-[1.1fr_0.9fr] lg:py-24">
        <div>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-ayira-200 bg-ayira-50 px-3 py-1 text-xs font-semibold text-ayira-700">
            <Sparkles size={13} aria-hidden />
            Built for Kenya's young workforce
          </span>

          <h1 className="mt-5 font-display text-4xl font-extrabold leading-[1.08] tracking-tight text-slate-900 sm:text-5xl lg:text-[3.4rem]">
            Find work that fits
            <span className="block text-ayira-700">the skills you already have.</span>
          </h1>

          {/* The underline is the shuka weave, not a decorative rule. */}
          <ShukaWeave className="mt-5 w-40 rounded-full" height={8} />

          <p className="mt-6 max-w-xl text-lg leading-relaxed text-slate-600">
            Ayira matches you to gigs by reading what you can actually do — not
            by how many keywords you managed to fit into a CV. Your pay is held
            safely until the work is done.
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link
              to="/signup"
              className="group inline-flex items-center gap-2 rounded-xl bg-ayira-600 px-6 py-3.5 font-semibold text-white shadow-lift transition-all hover:bg-ayira-700 hover:shadow-pop active:scale-[0.98]"
            >
              Create a free account
              <ArrowRight
                size={18}
                className="transition-transform group-hover:translate-x-0.5"
                aria-hidden
              />
            </Link>
            <a
              href="#how"
              className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-6 py-3.5 font-semibold text-slate-700 transition-colors hover:border-slate-400 hover:bg-slate-50"
            >
              See how it works
            </a>
          </div>

          <p className="mt-5 text-sm text-slate-500">
            Free to join. No fee to apply for work.
          </p>
        </div>

        <HeroCard />
      </div>

      <BeadBand className="w-full" tone="warm" />
    </section>
  );
}

/**
 * A sample match card.
 *
 * Shows the real shape of what the platform produces -- a score with its
 * reasons -- because "AI-powered" means nothing on its own and the breakdown
 * is the part that earns trust.
 */
function HeroCard() {
  return (
    <div className="relative mx-auto w-full max-w-sm animate-scale-in">
      <div className="absolute -inset-3 rounded-3xl bg-gradient-to-br from-gold-200/40 to-ayira-200/40 blur-xl" />

      <div className="relative rounded-2xl border border-slate-200 bg-white p-5 shadow-pop">
        <div className="mb-4 flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            Your top match
          </span>
          <span className="rounded-full bg-acacia-100 px-2.5 py-1 text-xs font-bold text-acacia-700">
            76% fit
          </span>
        </div>

        <h3 className="font-display text-lg font-bold text-slate-900">
          Solar panel installer
        </h3>
        <p className="mt-1 flex items-center gap-1.5 text-sm text-slate-500">
          <MapPin size={13} aria-hidden />
          Nakuru · 3 days
        </p>

        <p className="mt-3 font-display text-2xl font-bold text-gold-700">KES 18,500</p>

        <div className="mt-4 space-y-2.5 border-t border-slate-100 pt-4">
          <Bar label="Skills match" value={83} />
          <Bar label="Keyword overlap" value={49} />
          <Bar label="Near you" value={100} />
        </div>

        <div className="mt-4 flex items-center gap-1.5 border-t border-slate-100 pt-3 text-xs text-slate-500">
          <Star size={12} className="fill-gold-400 text-gold-500" aria-hidden />
          Employer rated 4.6 · 12 reviews
        </div>
      </div>
    </div>
  );
}

function Bar({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="text-slate-600">{label}</span>
        <span className="font-semibold tabular-nums text-slate-500">{value}%</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
        <div
          className="h-full rounded-full bg-gradient-to-r from-ayira-500 to-gold-500"
          style={{ width: `${value}%` }}
        />
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function WhatItIs() {
  return (
    <section className="mx-auto max-w-6xl px-5 py-16 sm:py-20">
      <SectionHeading
        eyebrow="What Ayira is"
        title="A hiring platform that understands the work"
        blurb="Three things make it different from a noticeboard."
      />

      <div className="mt-10 grid gap-5 sm:grid-cols-3">
        <Feature
          icon={<ScanSearch size={20} />}
          title="Matching that reads meaning"
          body="Describe your skills in your own words. Ayira compares the meaning of what you wrote against every open gig, so you are found even when you did not use the employer's exact wording."
        />
        <Feature
          icon={<ShieldCheck size={20} />}
          title="Pay held in escrow"
          body="The employer pays by M-Pesa before you start. Ayira holds it and releases it when the work is accepted, so neither side has to go first on trust."
          tone="gold"
        />
        <Feature
          icon={<BadgeCheck size={20} />}
          title="A reputation you own"
          body="Every finished gig can be reviewed by both sides. Your rating follows you, and you can read what people actually wrote rather than just a number."
          tone="acacia"
        />
      </div>
    </section>
  );
}

function HowItWorks() {
  return (
    <section id="how" className="relative overflow-hidden border-y border-slate-200 bg-white">
      <MudclothField />

      <div className="relative mx-auto max-w-6xl px-5 py-16 sm:py-20">
        <SectionHeading
          eyebrow="How it works"
          title="Joining takes about two minutes"
          blurb="Pick the side you are on. Everything else follows from that one choice."
        />

        <div className="mt-10 grid gap-8 lg:grid-cols-2">
          <Track
            heading="If you are looking for work"
            tone="ayira"
            steps={[
              {
                title: 'Create your account',
                body: 'Sign up with Google or an email address, and choose "I\'m looking for gigs".',
              },
              {
                title: 'List what you can do',
                body: 'Add your skills, a short bio and your town. This is what the matching reads, so plain language beats job titles.',
              },
              {
                title: 'Apply to your matches',
                body: 'Open AI Matches to see ranked gigs with the reason for each score. Apply, and propose your own amount if you want to.',
              },
              {
                title: 'Do the work, get paid',
                body: 'The employer funds escrow before you start. When they accept the work, the payment is released and you can review each other.',
              },
            ]}
          />

          <Track
            heading="If you are hiring"
            tone="gold"
            steps={[
              {
                title: 'Create your account',
                body: 'Sign up and choose "I\'m hiring". You can post immediately.',
              },
              {
                title: 'Post the gig',
                body: 'Title, what it involves, the skills you need, the town and your budget range. Mark it remote if location does not matter.',
              },
              {
                title: 'Review who applies',
                body: 'See each applicant\'s skills, rating and the reviews they have earned. Accept the one you want.',
              },
              {
                title: 'Fund escrow and release',
                body: 'Pay by M-Pesa STK push. Ayira holds it until you confirm the work is done, then releases it to the worker.',
              },
            ]}
          />
        </div>
      </div>
    </section>
  );
}

function Protection() {
  return (
    <section className="mx-auto max-w-6xl px-5 py-16 sm:py-20">
      <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-gradient-to-br from-slate-900 to-indigo-900 p-8 sm:p-12">
        <MudclothField className="opacity-[0.08]" />

        <div className="relative grid gap-8 lg:grid-cols-[1.2fr_0.8fr] lg:items-center">
          <div>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-gold-300">
              <Banknote size={13} aria-hidden />
              How your money is protected
            </span>

            <h2 className="mt-4 font-display text-2xl font-bold text-white sm:text-3xl">
              Neither side has to go first on trust
            </h2>

            <p className="mt-4 max-w-xl leading-relaxed text-slate-300">
              The oldest problem in casual work is that someone has to take a
              risk: the worker starts without being paid, or the employer pays
              before the work exists. Escrow removes the choice. The money is
              collected up front and held against that specific gig, and it moves
              only when the work is accepted.
            </p>

            <p className="mt-4 max-w-xl leading-relaxed text-slate-300">
              If the two of you disagree, either one can raise a dispute. An
              Ayira administrator reviews it and settles it — paying the worker,
              refunding the employer, or splitting it where the work was part
              done. Every decision is recorded with its reason.
            </p>
          </div>

          <ul className="space-y-3">
            {[
              ['Paid before you start', 'Escrow is funded by M-Pesa before any work begins.'],
              ['Held, not spent', 'Funds sit against the gig. Nobody can quietly withdraw them.'],
              ['Released on acceptance', 'One action by the employer, recorded with a timestamp.'],
              ['Disputes get a human', 'An administrator decides, and writes down why.'],
            ].map(([title, body]) => (
              <li key={title} className="flex gap-3 rounded-xl bg-white/5 p-3.5">
                <Handshake size={18} className="mt-0.5 shrink-0 text-gold-400" aria-hidden />
                <div>
                  <p className="text-sm font-semibold text-white">{title}</p>
                  <p className="mt-0.5 text-sm text-slate-400">{body}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

function JoinCta() {
  return (
    <section className="relative overflow-hidden border-t border-slate-200 bg-ayira-50/60">
      <div className="mx-auto max-w-3xl px-5 py-16 text-center sm:py-20">
        <AyiraMark size={44} className="mx-auto" />

        <h2 className="mt-5 font-display text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl">
          Ready to find your next gig?
        </h2>

        <p className="mx-auto mt-4 max-w-xl text-lg text-slate-600">
          Create an account, tell Ayira what you can do, and see what matches.
          It is free, and you are never charged to apply.
        </p>

        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link
            to="/signup"
            className="group inline-flex items-center gap-2 rounded-xl bg-ayira-600 px-7 py-3.5 font-semibold text-white shadow-lift transition-all hover:bg-ayira-700 hover:shadow-pop active:scale-[0.98]"
          >
            Join Ayira free
            <ArrowRight
              size={18}
              className="transition-transform group-hover:translate-x-0.5"
              aria-hidden
            />
          </Link>
          <Link
            to="/signin"
            className="inline-flex items-center rounded-xl border border-slate-300 bg-white px-7 py-3.5 font-semibold text-slate-700 transition-colors hover:border-slate-400"
          >
            I already have an account
          </Link>
        </div>
      </div>

      <ShukaWeave className="w-full weave-deep" height={10} />
    </section>
  );
}

function SiteFooter() {
  return (
    <footer className="bg-slate-900 py-10">
      <div className="mx-auto flex max-w-6xl flex-col items-center gap-4 px-5 text-center sm:flex-row sm:justify-between sm:text-left">
        <div className="flex items-center gap-2.5">
          <AyiraMark size={26} />
          <span className="font-display text-lg font-bold text-white">Ayira</span>
        </div>

        <p className="max-w-md text-sm leading-relaxed text-slate-400">
          An AI-powered gig platform for Africa's youth workforce. Built as a
          final-year Information Systems project at Strathmore University.
        </p>
      </div>
    </footer>
  );
}

/* -------------------------------------------------------------------------- */

function SectionHeading({
  eyebrow,
  title,
  blurb,
}: {
  eyebrow: string;
  title: string;
  blurb?: string;
}) {
  return (
    <div className="max-w-2xl">
      <span className="text-xs font-bold uppercase tracking-widest text-ayira-600">
        {eyebrow}
      </span>
      <h2 className="mt-2 font-display text-3xl font-extrabold tracking-tight text-slate-900">
        {title}
      </h2>
      {blurb && <p className="mt-3 text-lg text-slate-600">{blurb}</p>}
    </div>
  );
}

const FEATURE_TONES = {
  ayira: 'bg-ayira-50 text-ayira-700 ring-ayira-100',
  gold: 'bg-gold-50 text-gold-700 ring-gold-100',
  acacia: 'bg-acacia-50 text-acacia-700 ring-acacia-100',
} as const;

function Feature({
  icon,
  title,
  body,
  tone = 'ayira',
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  tone?: keyof typeof FEATURE_TONES;
}) {
  return (
    <div className="group rounded-2xl border border-slate-200 bg-white p-6 transition-all hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-lift">
      <span
        className={`inline-flex h-11 w-11 items-center justify-center rounded-xl ring-1 transition-transform group-hover:scale-105 ${FEATURE_TONES[tone]}`}
      >
        {icon}
      </span>
      <h3 className="mt-4 font-display text-lg font-bold text-slate-900">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-slate-600">{body}</p>
    </div>
  );
}

function Track({
  heading,
  tone,
  steps,
}: {
  heading: string;
  tone: 'ayira' | 'gold';
  steps: { title: string; body: string }[];
}) {
  const dot =
    tone === 'ayira'
      ? 'bg-ayira-600 ring-ayira-100'
      : 'bg-gold-600 ring-gold-100';

  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50/60 p-6">
      <h3 className="font-display text-xl font-bold text-slate-900">{heading}</h3>

      <ol className="mt-5 space-y-5">
        {steps.map((step, i) => (
          <li key={step.title} className="flex gap-4">
            <span className="flex flex-col items-center">
              <span
                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white ring-4 ${dot}`}
              >
                {i + 1}
              </span>
              {/* The connector stops after the last step rather than trailing
                  off into nothing. */}
              {i < steps.length - 1 && (
                <span className="mt-1 w-px flex-1 bg-slate-200" aria-hidden />
              )}
            </span>
            <div className="pb-1">
              <p className="font-semibold text-slate-900">{step.title}</p>
              <p className="mt-1 text-sm leading-relaxed text-slate-600">{step.body}</p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
