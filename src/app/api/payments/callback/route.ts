import { NextResponse, type NextRequest } from 'next/server';
import { PaymentError, reconcileCheckout } from '@/server/services/payment-service';

/**
 * Checkout Form callback — the browser redirect after the student pays.
 *
 * Iyzico POSTs here as a form submission from the user's browser. Two
 * consequences drive the whole handler:
 *
 * 1. **This request is attacker-controlled.** Anyone can POST a token here.
 *    So we read exactly one field — the token — and use it only to ask Iyzico
 *    what happened. Nothing in this body is believed, and no amount, status, or
 *    payment id from it is ever written to the database.
 *
 * 2. **It is a navigation, not an API call.** The response must be a redirect a
 *    human lands on, never JSON. Errors redirect to a page that explains
 *    itself; they never surface a stack trace to a 17-year-old who just typed
 *    in their card details.
 *
 * The callback is also not the source of truth for *whether* we get paid. If
 * the student closes the tab mid-redirect this never fires, and the webhook
 * plus the reconciliation sweep cover it. Treating the callback as merely one
 * of three triggers is what makes that safe.
 */

export const dynamic = 'force-dynamic';

function redirect(request: NextRequest, path: string, params: Record<string, string> = {}) {
  const url = new URL(path, request.nextUrl.origin);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return NextResponse.redirect(url, { status: 303 });
}

export async function POST(request: NextRequest) {
  let token: string | null = null;

  try {
    const contentType = request.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      const body = (await request.json()) as { token?: string };
      token = body.token ?? null;
    } else {
      const form = await request.formData();
      token = (form.get('token') as string | null) ?? null;
    }
  } catch {
    return redirect(request, '/odeme/hata', { neden: 'gecersiz_istek' });
  }

  if (!token) {
    return redirect(request, '/odeme/hata', { neden: 'eksik_token' });
  }

  try {
    const result = await reconcileCheckout(token);

    switch (result.outcome) {
      case 'CAPTURED':
      case 'ALREADY_PROCESSED':
        return redirect(request, '/odeme/basarili', { teklif: result.offerId ?? '' });
      case 'PENDING':
        // 3DS not finished, or fraud review. The webhook will finish the job;
        // the student sees a page that says "we're checking" rather than a
        // false failure that makes them pay twice.
        return redirect(request, '/odeme/beklemede', { teklif: result.offerId ?? '' });
      case 'FAILED':
        return redirect(request, '/odeme/hata', {
          neden: 'odeme_reddedildi',
          teklif: result.offerId ?? '',
        });
    }
  } catch (error) {
    if (error instanceof PaymentError && error.code === 'AMOUNT_MISMATCH') {
      // Money moved but our books disagree. Do not tell the student it failed —
      // it did not. Route to a page that says support is on it, and page us.
      console.error('[payments] AMOUNT MISMATCH on callback', { token, error });
      return redirect(request, '/odeme/inceleniyor');
    }
    console.error('[payments] callback reconciliation failed', { token, error });
    return redirect(request, '/odeme/hata', { neden: 'beklenmeyen' });
  }
}

/** Some Iyzico configurations issue a GET redirect instead. Handle both. */
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token');
  if (!token) return redirect(request, '/odeme/hata', { neden: 'eksik_token' });

  try {
    const result = await reconcileCheckout(token);
    return redirect(
      request,
      result.outcome === 'CAPTURED' || result.outcome === 'ALREADY_PROCESSED'
        ? '/odeme/basarili'
        : result.outcome === 'PENDING'
          ? '/odeme/beklemede'
          : '/odeme/hata',
      { teklif: result.offerId ?? '' },
    );
  } catch {
    return redirect(request, '/odeme/hata', { neden: 'beklenmeyen' });
  }
}
