import Link from 'next/link';
import { companyInfo } from '@/lib/legal/company';

/**
 * Site-wide footer with the legal identity 6563 requires to be visible
 * (title, address, tax details, contact) and links to every legal text.
 */
export function SiteFooter() {
  const c = companyInfo();

  return (
    <footer className="mx-auto max-w-5xl border-t border-stone/60 px-6 py-8 text-xs leading-relaxed text-muted sm:px-8">
      <nav className="flex flex-wrap gap-x-4 gap-y-1">
        <Link href="/yasal/kullanim-kosullari" className="hover:text-cactus">Kullanım Koşulları</Link>
        <Link href="/yasal/aydinlatma-metni" className="hover:text-cactus">KVKK Aydınlatma Metni</Link>
        <Link href="/yasal/cerez-politikasi" className="hover:text-cactus">Çerez Politikası</Link>
        <Link href="/yasal/iade-ve-itiraz" className="hover:text-cactus">İade ve İtiraz</Link>
        <Link href="/yasal" className="hover:text-cactus">Tüm yasal metinler</Link>
      </nav>
      <p className="mt-3">
        {c.title} · {c.address} · {c.taxOffice} V.D. {c.taxNumber}
        {c.mersis && ` · MERSİS ${c.mersis}`} · {c.email}
        {c.phone && ` · ${c.phone}`}
      </p>
      {c.etbisUrl && (
        <p className="mt-1">
          <a href={c.etbisUrl} target="_blank" rel="noopener noreferrer" className="hover:text-cactus">
            ETBİS kaydı
          </a>
        </p>
      )}
    </footer>
  );
}
