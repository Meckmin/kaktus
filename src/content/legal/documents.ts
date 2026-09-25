import type { CompanyInfo } from '@/lib/legal/company';

/**
 * Legal texts, written to match how the product actually works.
 *
 * DRAFTS. They were written from the code — escrow via Iyzico, 18% commission,
 * 5-day auto-release, 7-day dispute window, released instalments are final —
 * and must be reviewed by a lawyer before launch (YAYIN-REHBERI.md lists the
 * specific questions). Until LEGAL_TEXTS_APPROVED=1, every page shows a draft
 * notice.
 *
 * Bump LEGAL_VERSION whenever a text changes materially: consents are recorded
 * against a version, so a later dispute can show which text someone accepted.
 */
export const LEGAL_VERSION = '2026-09-25';

export type LegalSlug =
  | 'kullanim-kosullari'
  | 'aydinlatma-metni'
  | 'acik-riza'
  | 'cerez-politikasi'
  | 'mesafeli-hizmet-sozlesmesi'
  | 'araci-hizmet-sozlesmesi'
  | 'iade-ve-itiraz';

export interface LegalSection {
  heading: string;
  body: string[];
}

export interface LegalDocument {
  slug: LegalSlug;
  title: string;
  summary: string;
  sections: LegalSection[];
}

const COMMISSION = '%18';
const AUTO_RELEASE_DAYS = 5;
const DISPUTE_WINDOW_DAYS = 7;
const OFFER_EXPIRY_HOURS = 48;

export function legalDocuments(c: CompanyInfo): LegalDocument[] {
  const who = `${c.title} (“Kaktüs Koçluk”)`;
  const contact = `${c.email}${c.phone ? `, ${c.phone}` : ''}`;

  return [
    {
      slug: 'kullanim-kosullari',
      title: 'Kullanım Koşulları',
      summary: 'Siteyi kullanırken geçerli kurallar, tarafların rolleri ve sorumluluklar.',
      sections: [
        {
          heading: '1. Taraflar ve konu',
          body: [
            `Bu koşullar, ${c.siteUrl} adresindeki platformu işleten ${who} ile platformu kullanan öğrenciler, veliler ve koçlar arasındaki ilişkiyi düzenler. Platformu kullanan herkes bu koşulları kabul etmiş sayılır.`,
            'Kaktüs Koçluk, YKS’ye hazırlanan öğrencileri koçlarla buluşturan bir aracı hizmet sağlayıcıdır. Koçluk hizmetini koçlar kendi adlarına verir; Kaktüs Koçluk bu hizmetin tarafı değil, eşleştirme, güvenli ödeme ve anlaşmazlık çözümü hizmetlerinin sağlayıcısıdır.',
          ],
        },
        {
          heading: '2. Hesap ve yaş',
          body: [
            'Hesap e-posta bağlantısı ya da Google ile açılır. Hesabının güvenliğinden ve e-posta adresine erişimin kimde olduğundan sen sorumlusun.',
            '18 yaşından küçük kullanıcılar platformu velilerinin bilgisi ve onayıyla kullanır. Ödeme adımında ödeme bilgileri, ödemeyi yapan kişiye (18 yaşından küçük öğrenciler için veliye) aittir.',
          ],
        },
        {
          heading: '3. Teklif ve anlaşma',
          body: [
            `Öğrenci ile koç şartları platform üzerinden kararlaştırır. Bir teklif, karşı taraf kabul edene kadar bağlayıcı değildir; ${OFFER_EXPIRY_HOURS} saat içinde yanıtlanmayan teklif düşer. Kabul edilen teklif ödeme yapıldığında kesinleşir.`,
            'Öğrencinin teklifi, koçun ilgili paket için belirlediği fiyatın yarısından az olamaz; her teklif en az 100 ₺ olmalıdır.',
          ],
        },
        {
          heading: '4. Ödeme ve emanet',
          body: [
            'Ödemeler lisanslı ödeme kuruluşu İyzico aracılığıyla alınır. Ödenen tutar koça doğrudan geçmez; İyzico nezdinde tutulur ve her ders yapıldıkça dilimler hâlinde koça aktarılır. Kart bilgileri Kaktüs Koçluk tarafından görülmez ve saklanmaz.',
            `Koç bir dersi yapıldı olarak işaretlediğinde öğrenci onaylayabilir ya da sorun bildirebilir; ${AUTO_RELEASE_DAYS} gün içinde işlem yapılmazsa ilgili dilim koça aktarılır. Koça aktarılmış dilimler geri alınmaz.`,
          ],
        },
        {
          heading: '5. Platform dışında anlaşma yasağı',
          body: [
            'Taraflar, platform üzerinden tanıştıkları kişiyle ödeme ya da ders düzenlemesini platform dışına taşımamayı kabul eder. Mesajlarda telefon numarası, IBAN, sosyal medya hesabı gibi iletişim bilgileri otomatik olarak gizlenir. Bu kuralın ihlali hesabın kapatılmasına yol açabilir; platform dışında yapılan ödemeler güvence kapsamında değildir.',
          ],
        },
        {
          heading: '6. Koç doğrulaması',
          body: [
            'Koçların beyan ettiği YKS sıralaması, yüklenen ÖSYM belgesiyle bir inceleme ekibi tarafından kontrol edilir. İnceleme özen gösterilerek yapılır; ancak belgelerin gerçeğe uygunluğundan belgeyi yükleyen koç sorumludur.',
          ],
        },
        {
          heading: '7. Değerlendirmeler',
          body: [
            'Öğrenciler tamamlanan ya da yarıda kalan programlar için değerlendirme yazabilir; yarıda kalan programlara ait değerlendirmeler bu şekilde etiketlenir. Değerlendirmelerde öğrencinin yalnızca baş harfleri gösterilir. Hakaret, kişisel veri ya da gerçeğe aykırı içerik yayından kaldırılabilir.',
          ],
        },
        {
          heading: '8. Sorumluluğun sınırı',
          body: [
            'Kaktüs Koçluk, koçluk hizmetinin sonucunu (sınav başarısı, net artışı, yerleştirme) garanti etmez. Koçların verdiği hizmetin içeriğinden koç sorumludur. Kaktüs Koçluk’un sorumluluğu, kendi sağladığı aracılık ve ödeme hizmetleriyle sınırlıdır.',
          ],
        },
        {
          heading: '9. Değişiklikler ve iletişim',
          body: [
            'Bu koşullar güncellenebilir; önemli değişiklikler sitede duyurulur. Sorular için: ' + contact + '.',
          ],
        },
      ],
    },

    {
      slug: 'aydinlatma-metni',
      title: 'KVKK Aydınlatma Metni',
      summary: 'Hangi kişisel verileri, hangi amaçla işlediğimiz ve haklarının neler olduğu.',
      sections: [
        {
          heading: '1. Veri sorumlusu',
          body: [
            `6698 sayılı Kişisel Verilerin Korunması Kanunu (“KVKK”) kapsamında veri sorumlusu ${who}’dur. Adres: ${c.address}. İletişim: ${contact}${c.kep ? `, KEP: ${c.kep}` : ''}.`,
          ],
        },
        {
          heading: '2. İşlenen veriler',
          body: [
            'Kimlik ve iletişim: ad, soyad (girersen), e-posta adresi.',
            'Eşleştirme cevapları: alan, sınıf, hedef sıralama/üniversite/bölüm, deneme netleri, çalışma tarzı tercihleri, bütçe, müsait saatler.',
            'Platform içi yazışmalar ve teklifler; teklif ve ödeme geçmişi; değerlendirmeler.',
            'Ödeme adımında ödemeyi yapan kişinin ad, soyad, T.C. kimlik numarası, telefon ve adresi: yalnızca ödeme kuruluşu İyzico’ya iletilir, Kaktüs Koçluk tarafından saklanmaz. Kart bilgileri Kaktüs Koçluk’a hiç ulaşmaz.',
            'Koçlar için ayrıca: üniversite ve bölüm, YKS sıralaması ve ÖSYM belgesi, ödeme almak için T.C. kimlik/vergi numarası, IBAN, adres ve telefon (şifrelenerek saklanır).',
            'İşlem güvenliği: oturum bilgileri, IP adresi, tarayıcı bilgisi ve işlem kayıtları.',
          ],
        },
        {
          heading: '3. Amaçlar ve hukuki sebepler',
          body: [
            'Hesabının açılması, koç eşleştirmesi, teklif ve derslerin yürütülmesi, ödemelerin alınması ve koça aktarılması: sözleşmenin kurulması ve ifası (KVKK m.5/2-c).',
            'Faturalama, e-ticaret ve vergi mevzuatından doğan yükümlülükler: hukuki yükümlülük (m.5/2-ç).',
            'Koç belgelerinin doğrulanması, dolandırıcılığın ve platform dışı anlaşmaların önlenmesi, anlaşmazlıkların çözümü: meşru menfaat (m.5/2-f) ve bir hakkın tesisi, kullanılması veya korunması (m.5/2-e).',
          ],
        },
        {
          heading: '4. Aktarım',
          body: [
            'Veriler; ödeme için İyzico Ödeme Hizmetleri A.Ş.’ye, e-posta gönderimi için e-posta hizmet sağlayıcımıza, barındırma ve veritabanı hizmeti aldığımız bulut sağlayıcılarına, talep hâlinde yetkili kamu kurumlarına aktarılabilir.',
            'Barındırma, veritabanı ve e-posta sağlayıcılarımızın bir kısmı yurt dışında (Avrupa Birliği ve Amerika Birleşik Devletleri) bulunmaktadır. Yurt dışına aktarım, KVKK m.9’da öngörülen uygun güvenceler (standart sözleşme) çerçevesinde ya da bunun mümkün olmadığı hâllerde açık rızana dayanılarak yapılır.',
            'Koçlar, anlaştıkları öğrencinin adını (varsa) ve eşleştirme cevaplarını görebilir; öğrenciler koçun profilde yayımlanan bilgilerini görebilir. Değerlendirmelerde öğrencinin yalnızca baş harfleri yayımlanır.',
          ],
        },
        {
          heading: '5. Saklama süresi',
          body: [
            'Veriler, amaçların gerektirdiği süre boyunca ve ilgili mevzuatta öngörülen süreler kadar (ör. ticari ve vergi kayıtları için 10 yıl) saklanır; sonrasında silinir, yok edilir ya da anonim hâle getirilir. Üye olmadan cevaplanan eşleştirme soruları 30 gün sonra silinir.',
          ],
        },
        {
          heading: '6. Hakların',
          body: [
            'KVKK m.11 kapsamında; verilerinin işlenip işlenmediğini öğrenme, bilgi talep etme, amacına uygun kullanılıp kullanılmadığını öğrenme, aktarıldığı üçüncü kişileri bilme, eksik/yanlış verilerin düzeltilmesini, silinmesini isteme ve işlemenin sonuçlarına itiraz etme haklarına sahipsin.',
            `Başvurularını ${c.email} adresine ya da ${c.address} adresine yazılı olarak iletebilirsin. Başvurular en geç 30 gün içinde ücretsiz olarak yanıtlanır.`,
          ],
        },
      ],
    },

    {
      slug: 'acik-riza',
      title: 'Açık Rıza Metni',
      summary: 'Standart sözleşmenin yetmediği yurt dışı aktarımlar için açık rıza.',
      sections: [
        {
          heading: 'Yurt dışına aktarım',
          body: [
            `Aydınlatma Metni’nde açıklandığı üzere, ${who} platformun barındırma, veritabanı ve e-posta hizmetlerini yurt dışında bulunan hizmet sağlayıcılardan almaktadır. Bu aktarımlar öncelikle KVKK m.9’daki uygun güvenceler (standart sözleşme) ile yapılır.`,
            'Standart sözleşmenin uygulanamadığı durumlarda; kimlik, iletişim, eşleştirme cevapları ve platform içi yazışma verilerimin, platform hizmetinin sunulması amacıyla Avrupa Birliği ve Amerika Birleşik Devletleri’nde bulunan hizmet sağlayıcılara aktarılmasına açık rıza veriyorum.',
            `Bu rızamı dilediğim zaman ${c.email} adresine yazarak geri alabileceğimi, geri almanın geçmişteki aktarımların hukuka uygunluğunu etkilemeyeceğini biliyorum.`,
          ],
        },
      ],
    },

    {
      slug: 'cerez-politikasi',
      title: 'Çerez Politikası',
      summary: 'Sitenin kullandığı çerezler ve neden kullandığı.',
      sections: [
        {
          heading: 'Yalnızca zorunlu çerezler',
          body: [
            'Kaktüs Koçluk reklam, analiz ya da takip çerezi kullanmaz. Kullanılan çerezlerin tamamı sitenin çalışması için zorunludur ve bu nedenle ayrıca onay gerektirmez.',
          ],
        },
        {
          heading: 'Kullanılan çerezler',
          body: [
            'Oturum çerezi (authjs.session-token): giriş yaptığında seni tanımak için; 30 gün.',
            'Güvenlik çerezleri (authjs.csrf-token, authjs.callback-url): giriş işleminin güvenliği için; oturum boyunca.',
            'Eşleştirme cevapları (kk_onb): üye olmadan cevapladığın soruları, giriş yaptığında hesabına taşımak için; 30 gün.',
            'Teklif taslağı (kk_offer_draft): giriş ekranına geçerken hazırladığın teklifin kaybolmaması için; 6 saat.',
            'Ayrıca koç başvuru formunun yarıda kalan adımları, tarayıcının yerel depolamasında (localStorage) tutulur; ödeme bilgileri bu kayda hiçbir zaman yazılmaz.',
          ],
        },
        {
          heading: 'Çerezleri yönetmek',
          body: [
            'Tarayıcı ayarlarından çerezleri silebilir ya da engelleyebilirsin; bu durumda giriş yapmak ve teklif göndermek mümkün olmaz.',
          ],
        },
      ],
    },

    {
      slug: 'mesafeli-hizmet-sozlesmesi',
      title: 'Ön Bilgilendirme Formu ve Mesafeli Hizmet Sözleşmesi',
      summary: 'Öğrenci (ya da velisi) ile koç arasındaki koçluk hizmetinin şartları; ödeme öncesi onaylanır.',
      sections: [
        {
          heading: '1. Taraflar',
          body: [
            'Hizmet sağlayıcı: teklif kartında adı ve profili gösterilen koç (“Koç”).',
            'Hizmet alan: ödemeyi yapan kişi ve adına hizmet alınan öğrenci (“Öğrenci”).',
            `Aracı hizmet sağlayıcı: ${who}; Adres: ${c.address}; Vergi dairesi/no: ${c.taxOffice} / ${c.taxNumber}${c.mersis ? `; MERSİS: ${c.mersis}` : ''}; İletişim: ${contact}.`,
          ],
        },
        {
          heading: '2. Hizmetin konusu, bedeli ve süresi',
          body: [
            'Hizmet; kabul edilen teklifte yazan paket (tanışma seansı ya da 4 haftalık program), seans sayısı, seans süresi ve tarihlerde verilecek YKS koçluğudur. Seanslar çevrim içi yapılır.',
            'Bedel, kabul edilen teklifte gösterilen tutardır ve vergiler dahildir. Bedelin içinde Kaktüs Koçluk’un aracılık hizmet bedeli (' + COMMISSION + ') yer alır; ödeme ekranında ayrıca gösterilir.',
          ],
        },
        {
          heading: '3. Ödeme ve ifa',
          body: [
            'Ödeme İyzico aracılığıyla alınır ve İyzico nezdinde tutulur. Bedel, her ders yapıldıkça dilimler hâlinde koça aktarılır: koç dersi işaretler, öğrenci onaylar ya da ' + AUTO_RELEASE_DAYS + ' gün içinde sorun bildirmezse ilgili dilim koça aktarılır. Aktarılmış dilimler geri alınmaz.',
          ],
        },
        {
          heading: '4. Cayma hakkı',
          body: [
            'Mesafeli Sözleşmeler Yönetmeliği uyarınca, sözleşmenin kurulduğu tarihten itibaren 14 gün içinde gerekçe göstermeden cayma hakkın vardır; cayma bildirimini ' + c.email + ' adresine ya da platformdaki “İptal talebi” adımıyla iletebilirsin.',
            'Ancak Yönetmelik m.15/1-(ğ) uyarınca, cayma süresi dolmadan senin onayınla ifasına başlanan hizmetlerde cayma hakkı kullanılamaz. Bu nedenle ilk dersin yapılmasıyla birlikte, yapılmış dersler için cayma hakkı sona erer; henüz yapılmamış dersler için iade, “İade ve İtiraz Koşulları”na göre yapılır.',
          ],
        },
        {
          heading: '5. İade ve anlaşmazlık',
          body: [
            'Koçun derse gelmemesi, sözün yerine getirilmemesi gibi durumlarda son dersten sonraki ' + DISPUTE_WINDOW_DAYS + ' gün içinde platform üzerinden sorun bildirebilirsin. Bildirim, henüz aktarılmamış tutarı dondurur ve Kaktüs Koçluk ekibi tarafından incelenir; karar gerekçesiyle birlikte iki tarafa bildirilir. Ayrıntılar “İade ve İtiraz Koşulları”ndadır.',
          ],
        },
        {
          heading: '6. Şikâyet ve uyuşmazlık',
          body: [
            'Şikâyetlerini önce ' + contact + ' adresine iletebilirsin. Uyuşmazlıklarda, Ticaret Bakanlığı’nca her yıl ilan edilen parasal sınırlar dahilinde ikametgâhının bulunduğu yerdeki Tüketici Hakem Heyetleri ile Tüketici Mahkemeleri yetkilidir.',
          ],
        },
      ],
    },

    {
      slug: 'araci-hizmet-sozlesmesi',
      title: 'Aracı Hizmet Sözleşmesi (Koçlar için)',
      summary: 'Koç ile Kaktüs Koçluk arasındaki aracılık, komisyon ve ödeme şartları.',
      sections: [
        {
          heading: '1. Taraflar ve konu',
          body: [
            `Bu sözleşme ${who} ile platformda koçluk hizmeti sunan koç (“Koç”) arasında, Koç’un başvurusunu göndermesiyle kurulur. Kaktüs Koçluk, 6563 sayılı Kanun kapsamında aracı hizmet sağlayıcı olarak Koç’u öğrencilerle buluşturur, ödemeleri İyzico aracılığıyla emanette tutar ve anlaşmazlıkları karara bağlar.`,
          ],
        },
        {
          heading: '2. Başvuru ve doğrulama',
          body: [
            'Koç; gerçeğe uygun kimlik, üniversite, YKS sıralaması ve ÖSYM belgesi bilgisi vermeyi kabul eder. Başvuru incelenmeden profil yayına alınmaz. Gerçeğe aykırı beyan, hesabın kapatılması ve bekleyen ödemelerin öğrencilere iadesi sonucunu doğurabilir.',
          ],
        },
        {
          heading: '3. Hizmet bedeli (komisyon)',
          body: [
            `Kaktüs Koçluk, koça aktarılan her dilim üzerinden ${COMMISSION} aracılık hizmet bedeli alır. Komisyon yalnızca aktarılan (yani yapılmış derslere ait) tutarlardan alınır; iade edilen tutarlardan komisyon alınmaz. Oran değişiklikleri en az 30 gün önceden bildirilir ve yürürlükteki anlaşmaları etkilemez.`,
          ],
        },
        {
          heading: '4. Ödemeler',
          body: [
            'Koç, İyzico’da alt üye işyeri olarak kaydedilir; bunun için gereken kimlik/vergi ve IBAN bilgileri şifrelenerek saklanır ve yalnızca İyzico’ya iletilir. Bir dilim, Koç dersi yapıldı olarak işaretledikten sonra öğrencinin onayıyla ya da ' + AUTO_RELEASE_DAYS + ' gün içinde itiraz edilmemesiyle aktarılır. Paranın Koç’un banka hesabına geçiş süresi İyzico’nun kurallarına tabidir.',
            'Koç, derse ait saat gelmeden dersi yapıldı olarak işaretleyemez.',
            'Koç, kendi gelirinin vergilendirilmesinden kendisi sorumludur.',
          ],
        },
        {
          heading: '5. Platform dışı anlaşma yasağı',
          body: [
            'Koç, platform üzerinden tanıştığı öğrenciyle ödeme ya da ders düzenlemesini platform dışına taşımamayı, iletişim bilgisi paylaşmamayı kabul eder. İhlal hâlinde Kaktüs Koçluk hesabı askıya alabilir ya da kapatabilir.',
          ],
        },
        {
          heading: '6. Anlaşmazlıklar',
          body: [
            'Öğrencinin sorun bildirmesi hâlinde aktarılmamış tutar dondurulur. Kaktüs Koçluk tarafları dinleyerek tutarın koça aktarılmasına, öğrenciye iadesine ya da paylaştırılmasına gerekçeli olarak karar verir. Koça aktarılmış dilimler bu karardan etkilenmez.',
          ],
        },
        {
          heading: '7. Reşit olmayan öğrenciler',
          body: [
            'Öğrencilerin önemli bir kısmı 18 yaşından küçüktür. Koç, öğrenciyle yalnızca platform üzerinden ve eğitim amacıyla iletişim kurmayı, öğrencinin kişisel verilerini hizmet dışında kullanmamayı ve üçüncü kişilerle paylaşmamayı kabul eder.',
          ],
        },
        {
          heading: '8. Fesih',
          body: [
            'Koç dilediği zaman yeni öğrenci almayı durdurabilir ve hesabını kapatabilir; devam eden programlar bu sözleşme hükümlerine göre tamamlanır. Kaktüs Koçluk, sözleşmeye aykırılık hâlinde sözleşmeyi feshedebilir.',
          ],
        },
      ],
    },

    {
      slug: 'iade-ve-itiraz',
      title: 'İade ve İtiraz Koşulları',
      summary: 'Paranın ne zaman koça geçtiği, ne zaman sana döndüğü — sade bir özet.',
      sections: [
        {
          heading: 'Paran nerede duruyor?',
          body: [
            'Ödediğin tutar koça doğrudan gitmez; ödeme kuruluşu İyzico’da emanette durur. Her ders için bir ödeme dilimi vardır ve dilim ancak o dersin saati geçtikten sonra koça aktarılabilir.',
          ],
        },
        {
          heading: 'Ders yapıldığında',
          body: [
            `Koç dersi yapıldı olarak işaretler. “Onayla” dersen dilim hemen koça aktarılır; hiçbir şey yapmazsan ${AUTO_RELEASE_DAYS} gün sonra otomatik aktarılır. Aktarılmış dilimler geri alınmaz.`,
          ],
        },
        {
          heading: 'Bir sorun olduğunda',
          body: [
            `Koç derse gelmediyse, söz verilen kapsam sağlanmadıysa ya da koç mesajlara dönmüyorsa, ilgili dilimde “Sorun bildir”i kullan. Bildirim son dersten sonraki ${DISPUTE_WINDOW_DAYS} gün içinde yapılabilir.`,
            'Bildirimle birlikte henüz aktarılmamış tüm dilimler dondurulur. Ekibimiz iki tarafı dinler ve dondurulan tutarı koça aktarmaya, sana iade etmeye ya da paylaştırmaya gerekçesiyle karar verir.',
          ],
        },
        {
          heading: 'Programı bırakmak istersen',
          body: [
            'Ödeme yapmadan önce teklifi dilediğin zaman geri çekebilirsin; hiçbir ücret alınmaz.',
            'Ödemeden sonra “İptal talebi” ile programı sonlandırmak istediğini bildirebilirsin. Yapılmış derslerin ücreti koçta kalır; yapılmamış derslere ait tutar incelenerek iade edilir.',
          ],
        },
        {
          heading: 'İade ne zaman hesabıma geçer?',
          body: [
            'İade kararı verildiğinde tutar, ödemenin yapıldığı karta İyzico aracılığıyla iade edilir. Paranın kart hesabına yansıma süresi bankana bağlıdır ve genellikle birkaç iş günü sürer.',
          ],
        },
      ],
    },
  ];
}

export function legalDocument(slug: string, company: CompanyInfo): LegalDocument | null {
  return legalDocuments(company).find((doc) => doc.slug === slug) ?? null;
}
