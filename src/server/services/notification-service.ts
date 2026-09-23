import { prisma } from '@/lib/db';
import { emailHtml, sendEmail } from '@/lib/email';
import { formatTry } from '@/lib/onboarding/client-state';
import { env } from '@/lib/env';

/**
 * Deliberately not imported from `offer-service.ts`: that module calls
 * `dispatchNotifications`, so importing `DeferredWork` back from it would
 * make the two files circular. This is the same shape, kept in sync by hand —
 * a small price for a one-directional dependency.
 */
export interface NotifyWork {
  type: 'NOTIFY';
  audience: string;
  template: string;
  offerId: string;
}

/**
 * Turns the `NOTIFY` side effects `transitionOffer` collects into actual
 * emails.
 *
 * Called once, from inside `transitionOffer` itself, rather than by every
 * caller — a caller that forgets to read `.deferred` must not silently mean
 * "no one gets told their offer was accepted." See the state machine's effect
 * list (`src/lib/offers/state-machine.ts`) for the full set of transitions
 * this covers.
 *
 * Never throws: a notification is a consequence of a transition that has
 * already committed, not a precondition of it.
 */

type OfferParties = {
  title: string;
  priceMinor: number;
  conversationId: string;
  coach: { user: { email: string | null; name: string | null } };
  student: { user: { email: string | null; name: string | null } };
};

interface TemplateContext {
  title: string;
  priceMinor: string;
  coachName: string;
  studentName: string;
  panelUrl: string;
}

function render(template: string, ctx: TemplateContext): { subject: string; body: string } | null {
  switch (template) {
    case 'offer.received':
      return {
        subject: `Yeni teklif: ${ctx.title}`,
        body: `${ctx.priceMinor} tutarında yeni bir teklif aldın. Yanıtlamak için panele git.`,
      };
    case 'offer.countered':
      return {
        subject: `Karşı teklif: ${ctx.title}`,
        body: `${ctx.title} için karşı teklif geldi: ${ctx.priceMinor}. Panelden yanıtla.`,
      };
    case 'offer.accepted':
      return {
        subject: `Teklif kabul edildi: ${ctx.title}`,
        body: `${ctx.title} teklifin kabul edildi.`,
      };
    case 'escrow.funded':
      return {
        subject: `Ödeme alındı: ${ctx.title}`,
        body: `${ctx.title} için ödeme alındı ve Kaktüs'te güvence altında. Dersler başlangıç tarihinde başlayacak.`,
      };
    case 'engagement.started':
      return {
        subject: `Program başladı: ${ctx.title}`,
        body: `${ctx.title} programı başladı.`,
      };
    case 'engagement.completed':
      return {
        subject: `Program tamamlandı: ${ctx.title}`,
        body: `${ctx.title} programı tamamlandı. Teşekkürler!`,
      };
    case 'dispute.opened':
      return {
        subject: `İtiraz açıldı: ${ctx.title}`,
        body: `${ctx.title} için bir itiraz açıldı. İlgili dilimler dondu, ekip inceleyecek.`,
      };
    case 'dispute.resolved.release':
      return {
        subject: `İtiraz sonuçlandı: ${ctx.title}`,
        body: `${ctx.title} için açılan itiraz incelendi ve ücretin koça aktarılmasına karar verildi.`,
      };
    case 'dispute.resolved.refund':
      return {
        subject: `İtiraz sonuçlandı: ${ctx.title}`,
        body: `${ctx.title} için açılan itiraz incelendi ve ücretin öğrenciye iadesine karar verildi.`,
      };
    case 'escrow.refunded':
      return {
        subject: `Ödeme iade edildi: ${ctx.title}`,
        body: `${ctx.title} için alınan ödeme iade edildi.`,
      };
    case 'offer.cancelled':
      return {
        subject: `Teklif iptal edildi: ${ctx.title}`,
        body: `${ctx.title} teklifi iptal edildi.`,
      };
    case 'offer.expired':
      return {
        subject: `Teklifin süresi doldu: ${ctx.title}`,
        body: `${ctx.title} teklifinin yanıt süresi doldu.`,
      };
    default:
      return null;
  }
}

async function loadOfferParties(offerId: string): Promise<OfferParties | null> {
  return prisma.offer.findUnique({
    where: { id: offerId },
    select: {
      title: true,
      priceMinor: true,
      conversationId: true,
      coach: { select: { user: { select: { email: true, name: true } } } },
      student: { select: { user: { select: { email: true, name: true } } } },
    },
  });
}

async function adminEmails(): Promise<string[]> {
  const admins = await prisma.user.findMany({
    where: { roles: { has: 'ADMIN' } },
    select: { email: true },
  });
  return admins.map((a) => a.email).filter((e): e is string => Boolean(e));
}

export async function dispatchNotifications(deferred: readonly { type: string }[]): Promise<void> {
  const items = deferred.filter((d): d is NotifyWork => d.type === 'NOTIFY');
  if (items.length === 0) return;

  try {
    const offerIds = [...new Set(items.map((i) => i.offerId))];
    const loaded = await Promise.all(offerIds.map((id) => loadOfferParties(id)));
    const offers = new Map(offerIds.map((id, i) => [id, loaded[i]]));

    for (const item of items) {
      const offer = offers.get(item.offerId);
      if (!offer) continue;

      const rendered = render(item.template, {
        title: offer.title,
        priceMinor: formatTry(offer.priceMinor),
        coachName: offer.coach.user.name ?? 'Koç',
        studentName: offer.student.user.name ?? 'Öğrenci',
        panelUrl: `${env.APP_URL}/panel/sohbet/${offer.conversationId}`,
      });
      if (!rendered) {
        console.warn(`[notify] no template for "${item.template}"`);
        continue;
      }

      const recipients: string[] = [];
      if (item.audience === 'STUDENT' || item.audience === 'BOTH') {
        if (offer.student.user.email) recipients.push(offer.student.user.email);
      }
      if (item.audience === 'COACH' || item.audience === 'BOTH') {
        if (offer.coach.user.email) recipients.push(offer.coach.user.email);
      }
      if (item.audience === 'ADMIN') {
        recipients.push(...(await adminEmails()));
      }

      const panelUrl = `${env.APP_URL}/panel/sohbet/${offer.conversationId}`;
      await Promise.all(
        recipients.map((to) =>
          sendEmail({
            to,
            subject: rendered.subject,
            text: `${rendered.body}\n\n${panelUrl}`,
            html: emailHtml(rendered.subject, rendered.body, panelUrl, 'Panele git'),
          }),
        ),
      );
    }
  } catch (error) {
    // Notification dispatch must never take down the transition that
    // triggered it — everything inside is already best-effort, but this is
    // the outer net for the data loading around it.
    console.error('[notify] dispatchNotifications failed', error);
  }
}
