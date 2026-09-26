# Kaktüs Koçluk — Yayın Rehberi

Siteyi gerçek öğrencilere ve gerçek parayla açmak için yapılması gerekenler, sırasıyla.
Kod tarafı hazır; bu belgedeki adımların neredeyse tamamı **senin adına yapılması gereken
resmi işler ve hesap açılışları**. Her adımın sonunda ne elde etmen gerektiği yazıyor.

> **Sıra neden önemli:** Alan adını en sona bırakmak istedin, ama üç iş alan adı olmadan
> tamamlanamıyor: **İyzico başvurusu** (canlı site adresi ve yayında yasal metinler
> istenir), **ETBİS kaydı** (alan adıyla yapılır) ve **e-posta doğrulaması** (Resend).
> Bu yüzden alan adı 3. adımda. Onun dışındaki her şeyi paralel yürütebilirsin.

Her şeyin tamam olup olmadığını tek komutla görebilirsin:

```bash
vercel env pull .env.production     # Vercel'deki ayarları indirir
node --env-file=.env.production scripts/launch-check.mjs
```

Hepsi ✓ olunca yayına hazırsın. Komut gizli değerleri ekrana basmaz.

---

## 1. Şahıs şirketi (1–3 gün)

Bir **mali müşavirle** çalışmanı öneririm; şahıs şirketinde defter tutma zorunlu ve aşağıdaki
vergi sorularını en iyi o cevaplar.

1. İnternet Vergi Dairesi / e-Devlet üzerinden **işe başlama** başvurusu (ya da mali
   müşavirin yapar). Faaliyet kodu (NACE) olarak aracılık/web platformu faaliyetini
   mali müşavirinle birlikte seç.
2. Gerekiyorsa ticaret odasına kayıt.
3. **e-Arşiv fatura** kullanımını aç: Kaktüs Koçluk, koçlara komisyon faturası keseceksin.
4. Şahıs şirketin adına bir **banka hesabı** aç (İyzico'dan komisyon gelirin buraya yatar).

**Elde edeceklerin:** vergi levhası (unvan, vergi dairesi, vergi no), şirket adresi,
banka hesabı/IBAN, imza beyannamesi.

**Mali müşavire sor:**
- Öğrenci toplam tutarı ödüyor, koç parasını İyzico'dan alıyor, biz yalnızca %18
  komisyon alıyoruz. Komisyon faturasını koça mı kesiyoruz? Öğrenciye kim fatura kesiyor?
- Vergi kaydı olmayan bireysel koçlar (üniversite öğrencileri) gelir elde ediyor.
  Onların vergi durumu ne olur, bizim bir yükümlülüğümüz var mı (stopaj vb.)?

## 2. Hesaplar (1 gün, paralel yürüyebilir)

| Servis | Ne için | Plan |
|---|---|---|
| **Vercel** | Site + 5 dakikalık zamanlanmış işler | Pro (~20 $/ay). Hobby planda zamanlanmış işler günde bire iner, otomatik ödeme aktarımı gecikir. |
| **Supabase** | Veritabanı + belge depolama | Pro önerilir (günlük yedek). Bölge: **Frankfurt (eu-central-1)**. |
| **Upstash** | İstek sınırlama (Redis) | Ücretsiz plan yeter. Vercel Marketplace'ten eklemek en kolayı. |
| **Resend** | Giriş ve bildirim e-postaları | Ücretsiz plan: günde 100, ayda 3.000 mail. Alan adı doğrulanınca çalışır. |
| **Daily** (daily.co) | Uygulama içi görüntülü görüşme | Ayda 10.000 katılımcı-dakika ücretsiz (~80 saatlik birebir görüşme), sonra dakika başı 0,004 $. dashboard.daily.co → Developers → API key. **Hesaba kart tanımlanmadan görüşmeler açılmaz** ("Missing payment method"); ücretsiz kota yine geçerli, kart sadece aşımda kullanılır. Anahtarı ekledikten sonra `npm run daily-check` kurulumu gerçek API'ye karşı doğrular. |
| Google Cloud (opsiyonel) | "Google ile giriş" | İstemiyorsan boş bırak, e-posta ile giriş çalışır. |

### Supabase kurulumu
1. Yeni proje → bölge Frankfurt → güçlü bir veritabanı şifresi.
2. **Project Settings → Database → Connection string**:
   - `DATABASE_URL` → *Transaction pooler* (port 6543), sonuna `?pgbouncer=true&connection_limit=1` ekle.
   - `DIRECT_DATABASE_URL` → *Session pooler* ya da doğrudan bağlantı (port 5432). Migration'lar bununla çalışır.
3. **Storage → New bucket** → adı `verification`, **Public: kapalı**.
4. **Project Settings → API** → `SUPABASE_URL` ve `service_role` anahtarı (`SUPABASE_SERVICE_ROLE_KEY`).
   Bu anahtar tam yetkilidir; yalnızca Vercel ortam değişkenine koy.

### Vercel kurulumu
1. **Add New → Project** → GitHub'daki `Meckmin/kaktus` reposunu içe aktar.
   Build komutu otomatik olarak `vercel-build` olur: migration'ları uygular, sonra build eder.
2. **Settings → Environment Variables (Production)**, `.env.example`'daki anahtarlara göre:

   | Anahtar | Değer |
   |---|---|
   | `DATABASE_URL`, `DIRECT_DATABASE_URL` | Supabase'den |
   | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Supabase'den |
   | `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | Upstash'ten |
   | `AUTH_SECRET`, `CRON_SECRET`, `FIELD_ENCRYPTION_KEY` | Her biri için ayrı ayrı `openssl rand -base64 32` |
   | `APP_URL`, `AUTH_URL` | `https://<alan-adın>` (ikisi aynı) |
   | `AUTH_RESEND_KEY` | Resend'den |
   | `DAILY_API_KEY` | Daily'den (yoksa görüşmeler koçun ekleyeceği Zoom/Meet linkiyle yapılır) |
   | `EMAIL_FROM` | `Kaktüs Koçluk <merhaba@<alan-adın>>` |
   | `PAYMENT_PROVIDER` | Önce `mock`; İyzico onayından sonra `iyzico` |
   | `IYZICO_API_KEY`, `IYZICO_SECRET_KEY`, `IYZICO_BASE_URL` | 4. adımda |
   | `COMPANY_*` | 1. adımdaki vergi levhasından |
   | `ETBIS_URL` | 6. adımda |
   | `LEGAL_TEXTS_APPROVED` | Avukat onayından sonra `1` |

   **`FIELD_ENCRYPTION_KEY`'i güvenli bir yerde yedekle.** Koçların IBAN'ları bununla
   şifreleniyor; kaybolursa o veriler okunamaz.

   `AUTH_FORCE_EMAIL`, `AUTH_ALLOW_LOCAL_LINKS` ve `ALLOW_MOCK_PAYMENTS` production'da
   **olmamalı**.
3. Zamanlanmış iş `vercel.json`'dan otomatik kurulur. Vercel, `CRON_SECRET`'i isteğe kendisi ekler.

> Uygulama production'da eksik ya da yanlış ayarla **açılmayı reddeder** ve hangi anahtarın
> eksik olduğunu Vercel loglarında yazar. Bu bilerek böyle kuruldu.

## 3. Alan adı (sende)

1. Alan adını al (`.com` ya da `.com.tr`).
2. Vercel → **Settings → Domains** → alan adını ekle; Vercel'in gösterdiği DNS kayıtlarını
   alan adını aldığın yerin paneline gir.
3. Resend → **Domains → Add Domain** → gösterilen SPF/DKIM kayıtlarını DNS'e ekle → *Verify*.
   Ayrıca bir DMARC kaydı ekle (TXT, ad `_dmarc`, değer `v=DMARC1; p=none; rua=mailto:<COMPANY_EMAIL>`) —
   Gmail ve Outlook, DMARC'ı olmayan alan adlarından gelen postayı daha kolay spam'e atıyor.
4. `APP_URL`, `AUTH_URL`, `EMAIL_FROM`'u alan adıyla güncelle → Vercel'de **Redeploy**.
   `npm run launch-check` gönderici alan adını kontrol eder.
5. İlk kez giriş yap, sonra kendini admin yap (Supabase → SQL Editor):
   ```sql
   UPDATE "User" SET roles = '{STUDENT,ADMIN}' WHERE email = 'senin@epostan.com';
   ```

Bu noktada site yayında, ama ödemeler hâlâ sahte sağlayıcıyla (`mock`) çalışıyor ve
yasal sayfalarda "taslak" notu var. Gerçek kullanıcıya **henüz açma**.

## 4. İyzico pazaryeri (1–3 hafta)

1. iyzico.com → **Pazaryeri** çözümü için başvur. İstenenler genelde şunlar:
   vergi levhası, imza beyannamesi, kimlik, şirket IBAN'ı, **yayında olan web sitesi**
   (yasal metinler, iletişim bilgileri ve iade koşulları görünür olmalı).
2. Önce **sandbox** (test) anahtarlarını al:
   `IYZICO_BASE_URL=https://sandbox-api.iyzipay.com`, `PAYMENT_PROVIDER=iyzico`.
3. İyzico panelinde **bildirim (webhook) adresi**: `https://<alan-adın>/api/webhooks/iyzico`
4. Test kartlarıyla (docs.iyzico.com → Test Kartları) **baştan sona** dene:
   - koç başvurusu → admin onayı (koç İyzico'da alt üye işyeri olur),
   - teklif → ödeme (**3D Secure** dahil) → dersi işaretle → onayla → koça aktarım,
   - itiraz → iade.
5. Canlı onay gelince: canlı anahtarlar + `IYZICO_BASE_URL=https://api.iyzipay.com`.
6. **Gerçek kartla küçük bir ödeme** yap (100 ₺'lik tanışma seansı), sonra iade et.

**İyzico'ya sor:** Alıcı T.C. kimlik numarası zorunlu mu? Veli öğrenci adına ödeme
yaptığında alıcı bilgisi velininki olabilir mi? (Kod bu şekilde kuruldu.) Fraud
incelemesindeki (`fraudStatus`) ödemeler için önerdikleri politika ne?

## 5. Avukat

Taslak metinler kodda: `src/content/legal/documents.ts`. Canlı halleri sitede `/yasal`.
Avukata iki şey ver: **sitenin adresi** ve **bu listedeki sorular**.

Metinler:
Kullanım Koşulları · KVKK Aydınlatma Metni · Açık Rıza Metni · Çerez Politikası ·
Ön Bilgilendirme Formu ve Mesafeli Hizmet Sözleşmesi · Aracı Hizmet Sözleşmesi (koçlar) ·
İade ve İtiraz Koşulları.

**Sorulacaklar:**
1. **Reşit olmayanlar:** Öğrencilerin çoğu 17 yaşında. Hesap açma ve sözleşme kurma için
   "veli bilgisi dahilinde" notu ve ödemenin veli adına yapılabilmesi yeterli mi? Ayrı bir
   veli onayı adımı gerekiyor mu?
2. **Cayma hakkı:** Mesafeli Sözleşmeler Yönetmeliği m.15/1-(ğ) istisnasını ("onayla ifasına
   başlanan hizmet") doğru uyguluyor muyuz? Ödeme anındaki onay kutusu yeterli mi?
3. **Aracı hizmet sağlayıcı:** 6563 ve Aracı Hizmet Sağlayıcılar Yönetmeliği kapsamında
   sitede ve sözleşmelerde eksik bir yükümlülük var mı?
4. **KVKK, yurt dışı aktarım:** Barındırma, veritabanı ve e-posta AB/ABD'de. Standart
   sözleşme (SCC) imzalayıp 5 iş günü içinde Kurul'a bildirmek mi, açık rıza mı? Açık rıza
   metnini sitede nasıl sunmalıyız? (Şu an zorunlu bir onay kutusu olarak **eklenmedi**,
   çünkü hizmet açık rızaya bağlanamaz.)
5. **VERBİS:** Kayıt yükümlülüğümüz var mı, yoksa muaf mıyız?
6. **Sorumluluk sınırı:** Kullanım koşullarındaki sorumluluk sınırlaması tüketiciye karşı
   geçerli mi?
7. **Görüntülü görüşme:** Koç ile (çoğu reşit olmayan) öğrenci arasındaki görüşmeler kayıt
   alınmadan, yurt dışındaki bir sağlayıcı (Daily) üzerinden yapılıyor. Aydınlatma ve açık
   rıza metinleri bunu yeterince karşılıyor mu? Veli görüşmeye katılabilmeli mi? Kayıt almamak
   anlaşmazlıklarda kanıt açısından sorun olur mu?
8. **Koç–öğrenci ilişkisi:** Hizmeti koç veriyor, biz aracıyız. Mesafeli hizmet sözleşmesinin
   tarafları doğru kurgulanmış mı?

Avukatın değişikliklerini bana ilet, metinlere işleyeyim; ya da doğrudan dosyayı düzenle.
Metin değişince dosyadaki `LEGAL_VERSION`'ı güncelle: kullanıcı onayları hangi sürüme
verildiğiyle birlikte kaydediliyor. Onaydan sonra Vercel'de `LEGAL_TEXTS_APPROVED=1`.

## 6. ETBİS kaydı

Elektronik ticaret yapan herkes için zorunlu (alan adı gerekli).
1. etbis.ticaret.gov.tr → e-Devlet ile giriş → yeni kayıt → alan adın, faaliyet bilgileri.
2. Kayıt sonrası verilen doğrulama/QR bağlantısını `ETBIS_URL` olarak Vercel'e gir.
   Sitenin alt bilgisinde "ETBİS kaydı" bağlantısı olarak görünür.

## 7. KVKK işleri (avukatla birlikte)

- Yurt dışı aktarım için Vercel, Supabase, Resend, Upstash ve Daily'nin veri işleme sözleşmelerini
  (DPA) indir. Avukatın standart sözleşme yolunu seçerse sözleşmeyi imzala ve Kurul'a bildir.
- VERBİS kaydı (gerekiyorsa).
- Başvuru kanalı: aydınlatma metnindeki `COMPANY_EMAIL` adresine gelen KVKK taleplerine
  **30 gün içinde** cevap verilmeli.

## 8. Yayın günü

- [ ] `launch-check` tamamen ✓
- [ ] Gerçek kartla küçük ödeme + iade başarılı
- [ ] Vercel → **Cron Jobs** sayfasında `/api/cron/jobs` her 5 dakikada 200 dönüyor
- [ ] Giriş e-postası kendi alan adından geliyor, spam'e düşmüyor
- [ ] Test hesaplarıyla bir görüşme daveti gönder, kabul et, saatinde "Görüşmeye gir" ile iki
      farklı cihazdan bağlan (biri telefon olsun); görüşme sırasında programa görev ekle,
      karşı tarafta görünüyor mu bak
- [ ] `/yasal` sayfalarında "taslak" notu yok, alt bilgide şirket bilgileri ve ETBİS görünüyor
- [ ] Kendi hesabın admin, `/admin` açılıyor
- [ ] Gerçek koçlar başvurdu ve onaylandı (koçsuz açılan pazaryeri öğrenciye boş sayfa gösterir)

## Yayından sonra

- **Koça ödeme:** İyzico otomatik yapıyor. Dilim onaylanınca 5 dakikalık iş İyzico'ya onay
  gönderir, para İyzico'nun ödeme takvimine göre koçun hesabına geçer. Elle bir şey yapman
  gerekmez. (`npm run jobs:payouts` sadece sahte sağlayıcı içindir, canlıda hiçbir şey yapmaz.)
- **Yedekler:** Supabase Pro günlük yedek alır. Büyüdükçe point-in-time recovery açılabilir.
- **Loglar:** Vercel → Logs. Hata takibi için ileride Sentry eklenebilir.
- **Şifreleme anahtarı:** Koç sayısı artınca `FIELD_ENCRYPTION_KEY` yerine AWS KMS yoluna
  geçilebilir. Kod hazır, `.env.example`'da anlatılıyor.
