import { prisma } from '@/lib/db';
import type { Track } from '@/lib/matching/types';

/**
 * Coach profile read model.
 *
 * A single query shaped for the page rather than a set of generic repository
 * calls. Reviews, pricing, and credentials are all needed to render the first
 * paint, so fetching them separately would mean three round trips before the
 * hero appears.
 *
 * Note what is *not* selected: verification document keys, the coach's phone,
 * their sub-merchant key. Those live on the same row and have no business
 * crossing into a page that renders for anonymous visitors.
 */

const DEFAULT_COMMISSION_BPS = 1800;

export interface CoachProfileView {
  id: string;
  slug: string;
  displayName: string;
  headline: string;
  bio: string;
  introVideoUrl: string | null;
  city: string | null;
  timezone: string;
  university: string;
  department: string;
  graduationYear: number | null;
  yksRank: number;
  yksYear: number;
  yksTrack: Track;
  verifiedAt: Date | null;
  journey: {
    baselineTytNet: number | null;
    finalTytNet: number | null;
    baselineAytNet: number | null;
    finalAytNet: number | null;
    wasMezun: boolean;
  };
  tracks: string[];
  subjects: string[];
  styles: string[];
  supportedGrades: string[];
  specializations: Array<{ label: string; fromRank: number | null; toRank: number | null }>;
  pricingTiers: Array<{
    id: string;
    name: string;
    cadence: string;
    priceMinor: number;
    sessionsPerCycle: number;
    minutesPerSession: number;
    description: string | null;
  }>;
  stats: {
    ratingAvg: number;
    ratingCount: number;
    completedEngagements: number;
    activeEngagements: number;
    maxActiveStudents: number;
    responseP50Seconds: number | null;
    acceptingStudents: boolean;
  };
  reviews: Array<{
    id: string;
    rating: number;
    body: string | null;
    netGainReported: number | null;
    createdAt: Date;
    studentInitials: string;
  }>;
  commissionBps: number;
}

export async function getCoachProfile(slug: string): Promise<CoachProfileView | null> {
  const coach = await prisma.coachProfile.findUnique({
    where: { slug },
    select: {
      id: true,
      slug: true,
      headline: true,
      bio: true,
      introVideoUrl: true,
      city: true,
      timezone: true,
      university: true,
      department: true,
      graduationYear: true,
      yksRank: true,
      yksYear: true,
      yksTrack: true,
      verificationStatus: true,
      verifiedAt: true,
      ownBaselineTytNet: true,
      ownFinalTytNet: true,
      ownBaselineAytNet: true,
      ownFinalAytNet: true,
      wasMezun: true,
      tracks: true,
      subjects: true,
      styles: true,
      supportedGrades: true,
      ratingAvg: true,
      ratingCount: true,
      completedEngagements: true,
      activeEngagements: true,
      maxActiveStudents: true,
      responseP50Seconds: true,
      acceptingStudents: true,
      commissionBpsOverride: true,
      user: { select: { name: true } },
      specializations: { select: { label: true, fromRank: true, toRank: true } },
      pricingTiers: {
        where: { active: true },
        orderBy: { sortOrder: 'asc' },
        select: {
          id: true,
          name: true,
          cadence: true,
          priceMinor: true,
          sessionsPerCycle: true,
          minutesPerSession: true,
          description: true,
        },
      },
      reviews: {
        where: { published: true },
        orderBy: { createdAt: 'desc' },
        take: 6,
        select: {
          id: true,
          rating: true,
          body: true,
          netGainReported: true,
          createdAt: true,
          student: { select: { user: { select: { name: true } } } },
        },
      },
    },
  });

  // An unapproved coach is not a 403, it is a 404. Confirming that a pending or
  // suspended profile exists leaks a moderation decision to anyone with the URL.
  if (!coach || coach.verificationStatus !== 'APPROVED') return null;

  const policy =
    coach.commissionBpsOverride == null
      ? await prisma.commissionPolicy.findFirst({
          where: {
            effectiveFrom: { lte: new Date() },
            OR: [{ effectiveTo: null }, { effectiveTo: { gt: new Date() } }],
          },
          orderBy: { effectiveFrom: 'desc' },
          select: { defaultBps: true },
        })
      : null;

  return {
    id: coach.id,
    slug: coach.slug,
    displayName: coach.user.name ?? 'Koç',
    headline: coach.headline,
    bio: coach.bio,
    introVideoUrl: coach.introVideoUrl,
    city: coach.city,
    timezone: coach.timezone,
    university: coach.university,
    department: coach.department,
    graduationYear: coach.graduationYear,
    yksRank: coach.yksRank,
    yksYear: coach.yksYear,
    yksTrack: coach.yksTrack,
    verifiedAt: coach.verifiedAt,
    journey: {
      baselineTytNet: coach.ownBaselineTytNet,
      finalTytNet: coach.ownFinalTytNet,
      baselineAytNet: coach.ownBaselineAytNet,
      finalAytNet: coach.ownFinalAytNet,
      wasMezun: coach.wasMezun,
    },
    tracks: coach.tracks,
    subjects: coach.subjects,
    styles: coach.styles,
    supportedGrades: coach.supportedGrades,
    specializations: coach.specializations,
    pricingTiers: coach.pricingTiers,
    stats: {
      ratingAvg: coach.ratingAvg,
      ratingCount: coach.ratingCount,
      completedEngagements: coach.completedEngagements,
      activeEngagements: coach.activeEngagements,
      maxActiveStudents: coach.maxActiveStudents,
      responseP50Seconds: coach.responseP50Seconds,
      acceptingStudents: coach.acceptingStudents,
    },
    reviews: coach.reviews.map((review) => ({
      id: review.id,
      rating: review.rating,
      body: review.body,
      netGainReported: review.netGainReported,
      createdAt: review.createdAt,
      // Students are minors. Reviews show initials only — never a full name,
      // and never anything that ties a review to a school or a city.
      studentInitials: initials(review.student.user.name),
    })),
    commissionBps: coach.commissionBpsOverride ?? policy?.defaultBps ?? DEFAULT_COMMISSION_BPS,
  };
}

function initials(name: string | null): string {
  if (!name) return 'K.K.';
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => `${part[0]?.toLocaleUpperCase('tr')}.`)
      .join('') || 'K.K.'
  );
}
