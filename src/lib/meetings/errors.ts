import type { DailyEventObjectFatalError } from '@daily-co/daily-js';

/** Daily's fatal errors, in words a student can act on. */
export function describeFatal(event: Pick<DailyEventObjectFatalError, 'error' | 'errorMsg'>): string {
  // Problems with our Daily account (billing, plan limits) arrive untyped,
  // as "account-…". Nothing the student can fix — say so, and don't send
  // them off to check their Wi-Fi.
  if (event.errorMsg?.startsWith('account-')) {
    return 'Görüntülü görüşme şu an bizden kaynaklı bir sorun yüzünden açılamıyor. Varsa koçunun eklediği bağlantıyı kullan ya da birkaç dakika sonra tekrar dene.';
  }
  switch (event.error?.type) {
    case 'exp-room':
    case 'exp-token':
      return 'Görüşmenin süresi doldu, oda kapandı.';
    case 'nbf-room':
    case 'nbf-token':
      return 'Görüşme odası henüz açılmadı. Görüşme saatinden 10 dakika önce tekrar dene.';
    case 'ejected':
      return 'Görüşmeden çıkarıldın.';
    case 'meeting-full':
      return 'Görüşme odası dolu.';
    case 'no-room':
      return 'Görüşme odası bulunamadı. Tekrar dene; sorun sürerse koçunla sohbetten yazış.';
    case 'not-allowed':
      return 'Bu görüşmeye katılma iznin yok.';
    case 'connection-error':
      return 'Bağlantı kurulamadı ya da koptu. İnternet bağlantını kontrol edip tekrar dene.';
    default:
      return 'Görüşme odası açılamadı. Birkaç saniye sonra tekrar dene; sorun sürerse koçunla sohbetten yazış.';
  }
}
