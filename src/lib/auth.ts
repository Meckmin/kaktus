import NextAuth, { type DefaultSession } from 'next-auth';
import { PrismaAdapter } from '@auth/prisma-adapter';
import Google from 'next-auth/providers/google';
import Resend from 'next-auth/providers/resend';
import { cookies } from 'next/headers';
import { prisma } from '@/lib/db';
import { env } from '@/lib/env';
import { ONBOARDING_COOKIE, claimOnboardingSession } from '@/lib/onboarding/session';
import { deliveryMode, sendVerificationRequest } from '@/lib/magic-link';

declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      roles: ('STUDENT' | 'COACH' | 'ADMIN')[];
      hasStudentProfile: boolean;
      hasCoachProfile: boolean;
      coachStatus: string | null;
    } & DefaultSession['user'];
  }
}

// One line at boot, so "why didn't I get an email" is answered before it is
// asked. Printed on the server only.
if (deliveryMode() === 'local' && env.NODE_ENV !== 'test') {
  console.log(
    '[auth] Magic links print to the console and .auth-link.txt (no Resend key configured).',
  );
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  session: { strategy: 'database', maxAge: 60 * 60 * 24 * 30 },
  pages: {
    signIn: '/giris',
    verifyRequest: '/giris/eposta-gonderildi',
    error: '/giris/hata',
  },
  providers: [
    Google({
      allowDangerousEmailAccountLinking: false,
      authorization: { params: { prompt: 'select_account' } },
    }),
    Resend({
      /**
       * The provider id stays `resend` so `signIn('resend', …)` keeps working,
       * but delivery is entirely ours.
       *
       * `apiKey` is given a harmless placeholder when none is configured,
       * purely so the provider factory does not refuse to build. It is never
       * read: overriding `sendVerificationRequest` replaces the code path that
       * would have used it, so no Resend client is constructed and no request
       * to their API is made when the key is missing or a placeholder.
       */
      apiKey: env.AUTH_RESEND_KEY ?? env.RESEND_API_KEY ?? 'unused-local-dev',
      from: env.EMAIL_FROM,
      sendVerificationRequest,
    }),
  ],
  callbacks: {
    async session({ session, user }) {
      const [student, coach, record] = await Promise.all([
        prisma.studentProfile.findUnique({ where: { userId: user.id }, select: { id: true } }),
        prisma.coachProfile.findUnique({
          where: { userId: user.id },
          select: { id: true, verificationStatus: true },
        }),
        prisma.user.findUnique({ where: { id: user.id }, select: { roles: true, bannedAt: true } }),
      ]);

      if (record?.bannedAt) throw new Error('ACCOUNT_SUSPENDED');

      session.user.id = user.id;
      session.user.roles = record?.roles ?? ['STUDENT'];
      session.user.hasStudentProfile = Boolean(student);
      session.user.hasCoachProfile = Boolean(coach);
      session.user.coachStatus = coach?.verificationStatus ?? null;
      return session;
    },
  },
  events: {
    /**
     * The moment that makes the guest funnel work: the questionnaire answers
     * captured before signup become a real StudentProfile here, so the student
     * lands back on their match list with nothing lost.
     *
     * Runs on every sign-in, not just creation, because a student may complete
     * onboarding while already holding a dormant account from months earlier.
     */
    async signIn({ user }) {
      if (!user.id) return;
      const token = (await cookies()).get(ONBOARDING_COOKIE)?.value;
      if (!token) return;
      try {
        await claimOnboardingSession(token, user.id);
      } catch (error) {
        // Never block sign-in on this. A failed claim is recoverable from the
        // profile page; a failed sign-in is a lost user.
        console.error('onboarding claim failed', error);
      }
    },
  },
});

/** Throws in server actions when unauthenticated. */
export async function requireUser() {
  const session = await auth();
  if (!session?.user?.id) throw new Error('UNAUTHENTICATED');
  return session.user;
}

export async function requireCoach() {
  const user = await requireUser();
  const coach = await prisma.coachProfile.findUnique({ where: { userId: user.id } });
  if (!coach) throw new Error('NOT_A_COACH');
  if (coach.verificationStatus !== 'APPROVED') throw new Error('COACH_NOT_APPROVED');
  return coach;
}

export async function requireStudent() {
  const user = await requireUser();
  const student = await prisma.studentProfile.findUnique({ where: { userId: user.id } });
  if (!student) throw new Error('NO_STUDENT_PROFILE');
  return student;
}

export async function requireAdmin() {
  const user = await requireUser();
  if (!user.roles.includes('ADMIN')) throw new Error('FORBIDDEN');
  return user;
}
