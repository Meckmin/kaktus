/**
 * Development seed.
 *
 * Creates a marketplace with enough shape to actually exercise the product:
 * fifteen approved coaches across all four tracks, spread across price points,
 * rankings, working styles and availability, plus completed engagements and
 * reviews so the ranking signals have real data behind them.
 *
 * Three things this is careful about, because getting them wrong makes the
 * seeded data useless for testing:
 *
 *  1. **Coaches are payout-ready.** Approved, with a sub-merchant key. A coach
 *     missing either is invisible in search or blocked at payment, and you
 *     would spend an hour wondering why matching returns nothing.
 *  2. **Availability is in the future and does not overlap.** The calendar only
 *     renders upcoming slots, and the database refuses overlapping bookings for
 *     one coach — so historical bookings are placed in distinct past hours.
 *  3. **Ratings are backed by real reviews** for most coaches, not just written
 *     into the denormalised columns. The matcher reads reported net gain from
 *     review rows when scoring trajectory fit; faking only the average would
 *     leave that signal empty and quietly change the ranking you see.
 *
 * Re-runnable. Everything it creates uses the `@seed.kaktus.test` email domain
 * and is removed first, so your own hand-made accounts are never touched.
 *
 *   npm run db:seed
 */

import { PrismaClient, type Prisma } from '@prisma/client';

const prisma = new PrismaClient();

const SEED_DOMAIN = 'seed.kaktus.test';
const TZ = 'Europe/Istanbul';

/** 09:00–12:00, 13:00–17:00, 18:00–22:00 in minutes from local midnight. */
const BLOCKS = {
  morning: [9 * 60, 12 * 60],
  afternoon: [13 * 60, 17 * 60],
  evening: [18 * 60, 22 * 60],
} as const;

type BlockName = keyof typeof BLOCKS;

interface CoachSeed {
  slug: string;
  name: string;
  university: string;
  department: string;
  city: string;
  yksTrack: 'SAYISAL' | 'ESIT_AGIRLIK' | 'SOZEL' | 'DIL';
  yksRank: number;
  yksYear: number;
  ownBaselineNet: number;
  ownFinalNet: number;
  ownBaselineRank: number;
  wasMezun: boolean;
  tracks: Array<'SAYISAL' | 'ESIT_AGIRLIK' | 'SOZEL' | 'DIL'>;
  subjects: string[];
  styles: Array<'STRICT' | 'EMPATHETIC' | 'STRATEGIC' | 'HIGH_TOUCH'>;
  supportedGrades: Array<'GRADE_11' | 'GRADE_12' | 'MEZUN'>;
  headline: string;
  bio: string;
  monthlyPrice: number; // lira
  sessionPrice: number; // lira
  maxActiveStudents: number;
  activeEngagements: number;
  ratingAvg: number;
  ratingCount: number;
  completedEngagements: number;
  responseP50Seconds: number;
  cancellationRate: number;
  availability: Array<[weekday: number, block: BlockName]>;
  specializations: Array<{ label: string; fromRank: number | null; toRank: number | null }>;
  /** Net gains past students reported. Drives the trajectory signal. */
  reviewGains: Array<{ rating: number; gain: number; body: string }>;
}

/**
 * The roster is hand-written rather than generated. Random coaches produce
 * random matches, and you cannot tell a ranking bug from noise. These have
 * deliberate shapes: a top-ranked expensive one, a cheap new one with no
 * reviews, one at full capacity, one with almost no free hours, one who
 * climbed enormously and one who started near the top.
 */
const COACHES: CoachSeed[] = [
  {
    slug: 'elif-a',
    name: 'Elif A.',
    university: 'Boğaziçi Üniversitesi',
    department: 'Elektrik-Elektronik Mühendisliği',
    city: 'İstanbul',
    yksTrack: 'SAYISAL',
    yksRank: 412,
    yksYear: 2023,
    ownBaselineNet: 68,
    ownFinalNet: 108,
    ownBaselineRank: 38_000,
    wasMezun: true,
    tracks: ['SAYISAL'],
    subjects: ['AYT Matematik', 'TYT Matematik', 'Fizik'],
    styles: ['STRICT', 'STRATEGIC'],
    supportedGrades: ['GRADE_12', 'MEZUN'],
    headline: 'Mezun yılında 38 binden ilk 500’e. Aynı yolu tarif ediyorum.',
    bio: `Mezun olduğum yıl 38 bininci sıradaydım ve herkes "bu iş bitti" diyordu. Bir sonraki sene 412. sıradan Boğaziçi EEM kazandım.\n\nÇalışma şeklim net: haftalık program veriyorum, pazar akşamı deneme analizini birlikte yapıyoruz, teslim etmediğin ödevin mazereti olmuyor. Sıkı bir takip istemiyorsan benimle çalışmak zor gelebilir.\n\nÖzellikle AYT matematikte 20 netin altında takılmış, nereden başlayacağını bilemeyen öğrencilerle iyi çalışıyorum.`,
    monthlyPrice: 5800,
    sessionPrice: 1600,
    maxActiveStudents: 6,
    activeEngagements: 5,
    ratingAvg: 4.9,
    ratingCount: 23,
    completedEngagements: 27,
    responseP50Seconds: 2400,
    cancellationRate: 0.01,
    availability: [
      [1, 'evening'],
      [3, 'evening'],
      [6, 'morning'],
    ],
    specializations: [
      { label: 'Mezun yılında 50 binden ilk 1000’e', fromRank: 50_000, toRank: 1_000 },
      { label: 'AYT Matematik sıfırdan kurulum', fromRank: null, toRank: null },
    ],
    reviewGains: [
      { rating: 5, gain: 34, body: 'Programı harfiyen uyguladım, AYT matematikte 9 netten 31 nete çıktım.' },
      { rating: 5, gain: 28, body: 'Sıkı takip gerçekten sıkı. Bana lazım olan buydu.' },
      { rating: 4, gain: 19, body: 'Çok faydalıydı ama tempoya alışmak ilk ay zor geldi.' },
    ],
  },
  {
    slug: 'mert-k',
    name: 'Mert K.',
    university: 'İstanbul Teknik Üniversitesi',
    department: 'Bilgisayar Mühendisliği',
    city: 'İstanbul',
    yksTrack: 'SAYISAL',
    yksRank: 2_180,
    yksYear: 2024,
    ownBaselineNet: 74,
    ownFinalNet: 99,
    ownBaselineRank: 21_000,
    wasMezun: false,
    tracks: ['SAYISAL'],
    subjects: ['AYT Matematik', 'Fizik', 'TYT Fen'],
    styles: ['STRATEGIC', 'EMPATHETIC'],
    supportedGrades: ['GRADE_11', 'GRADE_12'],
    headline: '12. sınıfta panik yapmadan ilk 3 bine çıkmanın yolu var.',
    bio: `12. sınıfa 21 bininci sırayla girdim, yıl sonunda 2180. sıradaydım. Hiç mezun olmadım — okulla birlikte yürütülebilir bir program kurmayı biliyorum.\n\nBende ağırlık deneme analizinde. Hangi soruyu neden yanlış yaptığını ayırt edemeyen bir öğrenci, 500 deneme de çözse aynı yerde kalıyor.\n\nHaftada bir uzun görüşme yapıyoruz, arada mesajla takıldığın yeri soruyorsun.`,
    monthlyPrice: 3400,
    sessionPrice: 950,
    maxActiveStudents: 10,
    activeEngagements: 4,
    ratingAvg: 4.7,
    ratingCount: 11,
    completedEngagements: 13,
    responseP50Seconds: 5400,
    cancellationRate: 0.03,
    availability: [
      [2, 'evening'],
      [4, 'evening'],
      [0, 'afternoon'],
    ],
    specializations: [{ label: '12. sınıfta okulla birlikte ilk 5 bin', fromRank: 25_000, toRank: 5_000 }],
    reviewGains: [
      { rating: 5, gain: 22, body: 'Deneme analizi yapmayı öğrendim, en çok bu işe yaradı.' },
      { rating: 4, gain: 15, body: 'Okul yoğunluğunu anlıyor, program buna göre.' },
    ],
  },
  {
    slug: 'zeynep-d',
    name: 'Zeynep D.',
    university: 'Hacettepe Üniversitesi',
    department: 'Tıp',
    city: 'Ankara',
    yksTrack: 'SAYISAL',
    yksRank: 890,
    yksYear: 2022,
    ownBaselineNet: 81,
    ownFinalNet: 104,
    ownBaselineRank: 12_000,
    wasMezun: false,
    tracks: ['SAYISAL'],
    subjects: ['Biyoloji', 'Kimya', 'AYT Matematik'],
    styles: ['EMPATHETIC', 'HIGH_TOUCH'],
    supportedGrades: ['GRADE_11', 'GRADE_12', 'MEZUN'],
    headline: 'Tıp hedefliyorsan biyoloji ve kimyayı ezber olmaktan çıkaralım.',
    bio: `Hacettepe Tıp 3. sınıf öğrencisiyim. Sayısalda en çok göz ardı edilen şey biyoloji ve kimya — matematiğe gömülüp bu ikisinden net kaybeden çok öğrenci görüyorum.\n\nGünlük kısa kontrollerle çalışıyorum. Uzun haftalık görüşmeler yerine her gün iki dakikalık "bugün ne yaptın" mesajı daha çok işe yarıyor, özellikle motivasyonu dalgalı öğrencilerde.\n\nKötü geçen haftalarda bırakmayı düşünen öğrencilerle çalışmayı seviyorum; o hafta herkesin başına geliyor.`,
    monthlyPrice: 4600,
    sessionPrice: 1300,
    maxActiveStudents: 8,
    activeEngagements: 3,
    ratingAvg: 4.8,
    ratingCount: 18,
    completedEngagements: 20,
    responseP50Seconds: 1800,
    cancellationRate: 0.02,
    availability: [
      [1, 'afternoon'],
      [2, 'afternoon'],
      [4, 'evening'],
      [6, 'morning'],
    ],
    specializations: [{ label: 'Tıp hedefiyle biyoloji-kimya derinleşmesi', fromRank: 15_000, toRank: 2_000 }],
    reviewGains: [
      { rating: 5, gain: 26, body: 'Biyolojide 4 netten 12 nete çıktım, kimya da toparlandı.' },
      { rating: 5, gain: 21, body: 'Her gün mesajlaşmak bırakmamı engelledi diyebilirim.' },
      { rating: 4, gain: 14, body: 'Matematikte biraz daha destek isterdim ama biyoloji harikaydı.' },
    ],
  },
  {
    slug: 'can-o',
    name: 'Can Ö.',
    university: 'Orta Doğu Teknik Üniversitesi',
    department: 'Makine Mühendisliği',
    city: 'Ankara',
    yksTrack: 'SAYISAL',
    yksRank: 6_400,
    yksYear: 2024,
    ownBaselineNet: 52,
    ownFinalNet: 91,
    ownBaselineRank: 84_000,
    wasMezun: true,
    tracks: ['SAYISAL', 'ESIT_AGIRLIK'],
    subjects: ['TYT Matematik', 'AYT Matematik', 'Fizik'],
    styles: ['HIGH_TOUCH', 'EMPATHETIC'],
    supportedGrades: ['MEZUN'],
    headline: '84 binden 6 bine. Sıfıra yakın başlayanları anlıyorum.',
    bio: `İlk girdiğim sene 84 bininci sıradaydım, TYT matematikte 8 netim vardı. Mezun yılımda 6400. sıraya çıktım.\n\nÇok düşük netten başlayan öğrenciyle çalışmak ayrı bir iş. Konu anlatımı değil, "bugün hangi 3 soruyu çözeceksin" seviyesinde bir kurulum gerekiyor. Ben orayı biliyorum çünkü aynı yerden başladım.\n\nSık temas ediyorum, günde bir mesaj atıyorum. Kimseyi azarlamam; zaten yeterince baskı var.`,
    monthlyPrice: 2600,
    sessionPrice: 750,
    maxActiveStudents: 12,
    activeEngagements: 6,
    ratingAvg: 4.6,
    ratingCount: 9,
    completedEngagements: 11,
    responseP50Seconds: 3600,
    cancellationRate: 0.04,
    availability: [
      [1, 'morning'],
      [3, 'morning'],
      [5, 'afternoon'],
      [0, 'evening'],
    ],
    specializations: [{ label: 'Mezun yılında 80 binden ilk 10 bine', fromRank: 100_000, toRank: 10_000 }],
    reviewGains: [
      { rating: 5, gain: 31, body: 'TYT matematikte 6 nettim, 24 nete çıktım. Hiç küçümsemedi.' },
      { rating: 4, gain: 18, body: 'Sabırlı biri. Sıfırdan başlıyorsan doğru adres.' },
    ],
  },
  {
    slug: 'irem-s',
    name: 'İrem S.',
    university: 'Ege Üniversitesi',
    department: 'Diş Hekimliği',
    city: 'İzmir',
    yksTrack: 'SAYISAL',
    yksRank: 14_200,
    yksYear: 2025,
    ownBaselineNet: 61,
    ownFinalNet: 84,
    ownBaselineRank: 46_000,
    wasMezun: false,
    tracks: ['SAYISAL'],
    subjects: ['TYT Matematik', 'Biyoloji', 'TYT Fen'],
    styles: ['EMPATHETIC'],
    supportedGrades: ['GRADE_11', 'GRADE_12'],
    headline: 'Yeni mezunum, süreç hâlâ çok taze. Uygun fiyatlı başlangıç.',
    bio: `Geçen sene sınava girdim, Ege Diş kazandım. Kaktüs’te yeniyim, bu yüzden fiyatım düşük — referansımı buradan kuracağım.\n\n11 ve 12. sınıf öğrencileriyle çalışıyorum. Sınav sürecinin nasıl bir şey olduğunu hatırlıyorum, çünkü üzerinden bir yıl bile geçmedi.\n\nHaftada bir görüşme, arada mesaj. Program veriyorum ama esnek; hayatında başka şeyler de olduğunu biliyorum.`,
    monthlyPrice: 1400,
    sessionPrice: 450,
    maxActiveStudents: 8,
    activeEngagements: 0,
    ratingAvg: 0,
    ratingCount: 0,
    completedEngagements: 0,
    responseP50Seconds: 1200,
    cancellationRate: 0,
    availability: [
      [1, 'evening'],
      [2, 'evening'],
      [3, 'evening'],
      [4, 'evening'],
      [6, 'afternoon'],
    ],
    specializations: [],
    reviewGains: [],
  },
  {
    slug: 'burak-t',
    name: 'Burak T.',
    university: 'Yıldız Teknik Üniversitesi',
    department: 'İnşaat Mühendisliği',
    city: 'İstanbul',
    yksTrack: 'SAYISAL',
    yksRank: 24_500,
    yksYear: 2023,
    ownBaselineNet: 44,
    ownFinalNet: 76,
    ownBaselineRank: 95_000,
    wasMezun: true,
    tracks: ['SAYISAL'],
    subjects: ['TYT Matematik', 'TYT Fen', 'Fizik'],
    styles: ['STRICT', 'HIGH_TOUCH'],
    supportedGrades: ['GRADE_12', 'MEZUN'],
    headline: 'TYT’si oturmayan öğrenciyle AYT’ye geçmem.',
    bio: `Çoğu öğrenci TYT matematiği yarım bırakıp AYT’ye atlıyor ve ikisinde birden batıyor. Benimle çalışırsan TYT netin oturmadan AYT’ye geçmeyiz — bu bazen ilk iki ay sıkıcı geliyor, sonuçları sonra görüyorsun.\n\nKendi sürecimde 95 binden 24 bine çıktım. Zeki olduğum için değil, sırayı bozmadığım için.\n\nHaftada iki kısa görüşme yapıyorum, her gün ödev kontrolü var.`,
    monthlyPrice: 2200,
    sessionPrice: 650,
    maxActiveStudents: 10,
    activeEngagements: 2,
    ratingAvg: 4.4,
    ratingCount: 6,
    completedEngagements: 7,
    responseP50Seconds: 7200,
    cancellationRate: 0.06,
    availability: [
      [2, 'morning'],
      [4, 'morning'],
      [5, 'evening'],
    ],
    specializations: [{ label: 'TYT temeli sıfırdan kurma', fromRank: 150_000, toRank: 30_000 }],
    reviewGains: [
      { rating: 5, gain: 24, body: 'TYT matematiği gerçekten oturttu. İlk iki ay sabır gerekiyor.' },
      { rating: 4, gain: 12, body: 'Disiplinli ama bazen mesajlara geç dönüyor.' },
    ],
  },
  {
    slug: 'selin-y',
    name: 'Selin Y.',
    university: 'Koç Üniversitesi',
    department: 'Hukuk',
    city: 'İstanbul',
    yksTrack: 'ESIT_AGIRLIK',
    yksRank: 620,
    yksYear: 2023,
    ownBaselineNet: 72,
    ownFinalNet: 101,
    ownBaselineRank: 18_000,
    wasMezun: false,
    tracks: ['ESIT_AGIRLIK'],
    subjects: ['AYT Matematik', 'Edebiyat', 'TYT Türkçe'],
    styles: ['STRATEGIC', 'STRICT'],
    supportedGrades: ['GRADE_12', 'MEZUN'],
    headline: 'EA’da fark matematikten değil, edebiyattan açılıyor.',
    bio: `Koç Hukuk burslu okuyorum. EA öğrencilerinin çoğu matematiğe gömülüp edebiyatı "okuyunca olur" sanıyor; sıralama farkı tam olarak orada açılıyor.\n\nParagraf ve edebiyat sorularında sistematik bir yaklaşım kuruyorum. Matematikte de çalışıyoruz ama önceliği veriye göre belirliyoruz.\n\nDeneme sonuçlarını birlikte tabloluyoruz. Duyguya göre değil, sayıya göre karar veriyoruz.`,
    monthlyPrice: 5200,
    sessionPrice: 1450,
    maxActiveStudents: 7,
    activeEngagements: 4,
    ratingAvg: 4.9,
    ratingCount: 15,
    completedEngagements: 17,
    responseP50Seconds: 3000,
    cancellationRate: 0.01,
    availability: [
      [1, 'evening'],
      [4, 'evening'],
      [6, 'afternoon'],
    ],
    specializations: [{ label: 'EA’da ilk 1000 için edebiyat stratejisi', fromRank: 20_000, toRank: 1_000 }],
    reviewGains: [
      { rating: 5, gain: 27, body: 'Edebiyatta 18 netten 32 nete çıktım, sıralamam uçtu.' },
      { rating: 5, gain: 23, body: 'Her şeyi tabloya döküyor, tahmin yok.' },
    ],
  },
  {
    slug: 'kaan-b',
    name: 'Kaan B.',
    university: 'Ankara Üniversitesi',
    department: 'Hukuk',
    city: 'Ankara',
    yksTrack: 'ESIT_AGIRLIK',
    yksRank: 3_900,
    yksYear: 2024,
    ownBaselineNet: 58,
    ownFinalNet: 93,
    ownBaselineRank: 42_000,
    wasMezun: true,
    tracks: ['ESIT_AGIRLIK', 'SOZEL'],
    subjects: ['Edebiyat', 'Tarih', 'Coğrafya', 'AYT Matematik'],
    styles: ['EMPATHETIC', 'STRATEGIC'],
    supportedGrades: ['MEZUN', 'GRADE_12'],
    headline: 'Mezun yılında 42 binden 3900’e. Sosyal derslerde iddialıyım.',
    bio: `Mezun yılımda hukuk hedefiyle çalıştım ve 3900. sıraya geldim. En çok tarih ve coğrafyada fark yarattım — EA’da bu ikisi çoğu zaman "sonra bakarız" rafında kalıyor.\n\nMezun psikolojisi ayrı bir mesele. Okul yok, arkadaş yok, gün boyu evde tek başınasın. Bunu yaşamış biri olarak programı buna göre kuruyorum.\n\nHaftada bir uzun görüşme, arada sınırsız mesaj.`,
    monthlyPrice: 3100,
    sessionPrice: 900,
    maxActiveStudents: 9,
    activeEngagements: 3,
    ratingAvg: 4.7,
    ratingCount: 12,
    completedEngagements: 14,
    responseP50Seconds: 4200,
    cancellationRate: 0.02,
    availability: [
      [0, 'afternoon'],
      [2, 'evening'],
      [5, 'evening'],
    ],
    specializations: [{ label: 'Mezun yılında EA ilk 5 bin', fromRank: 50_000, toRank: 5_000 }],
    reviewGains: [
      { rating: 5, gain: 29, body: 'Tarih ve coğrafyayı toparlamak sıralamamı 20 bin yukarı taşıdı.' },
      { rating: 4, gain: 17, body: 'Mezun sürecinde psikolojik olarak da destek oldu.' },
    ],
  },
  {
    slug: 'ayse-m',
    name: 'Ayşe M.',
    university: 'Marmara Üniversitesi',
    department: 'İşletme',
    city: 'İstanbul',
    yksTrack: 'ESIT_AGIRLIK',
    yksRank: 18_700,
    yksYear: 2025,
    ownBaselineNet: 49,
    ownFinalNet: 78,
    ownBaselineRank: 72_000,
    wasMezun: false,
    tracks: ['ESIT_AGIRLIK'],
    subjects: ['TYT Türkçe', 'TYT Matematik', 'Edebiyat'],
    styles: ['HIGH_TOUCH', 'EMPATHETIC'],
    supportedGrades: ['GRADE_11', 'GRADE_12'],
    headline: 'Uygun fiyat, sık temas. 11. sınıfta erken başlayanlar için.',
    bio: `Geçen sene sınava girdim. 11. sınıfta başlayan öğrencilerle çalışmayı tercih ediyorum çünkü erken başlayınca panik olmadan ilerleniyor.\n\nGünlük kısa kontroller yapıyorum. Uzun haftalık toplantılar yerine sık ve kısa temas, bu yaşta daha iyi çalışıyor.\n\nHenüz çok öğrencim olmadı, bu yüzden fiyatım düşük ve her öğrenciye fazlasıyla vakit ayırıyorum.`,
    monthlyPrice: 1650,
    sessionPrice: 500,
    maxActiveStudents: 6,
    activeEngagements: 1,
    ratingAvg: 5.0,
    ratingCount: 2,
    completedEngagements: 2,
    responseP50Seconds: 900,
    cancellationRate: 0,
    availability: [
      [1, 'afternoon'],
      [3, 'afternoon'],
      [5, 'afternoon'],
      [6, 'morning'],
    ],
    specializations: [],
    reviewGains: [{ rating: 5, gain: 16, body: 'Çok ilgili. 11. sınıfta başlamak doğru karardı.' }],
  },
  {
    slug: 'emre-c',
    name: 'Emre Ç.',
    university: 'Galatasaray Üniversitesi',
    department: 'İktisat',
    city: 'İstanbul',
    yksTrack: 'ESIT_AGIRLIK',
    yksRank: 1_450,
    yksYear: 2022,
    ownBaselineNet: 79,
    ownFinalNet: 97,
    ownBaselineRank: 9_800,
    wasMezun: false,
    tracks: ['ESIT_AGIRLIK'],
    subjects: ['AYT Matematik', 'TYT Matematik'],
    styles: ['STRATEGIC'],
    supportedGrades: ['GRADE_12', 'MEZUN'],
    headline: 'Sadece matematik. Haftada bir, yoğun ve planlı.',
    bio: `EA matematiği üzerine yoğunlaşıyorum, başka ders almıyorum. Zaten iyi olan ama son adımı atamayan öğrencilerle iyi sonuç alıyorum.\n\nHaftada tek görüşme yapıyorum ve o görüşme yoğun geçiyor. Aradaki sürede kendi başına çalışabilecek disiplinde olman gerekiyor — günlük takip bende yok.\n\n9800’den 1450’ye çıkışım tamamen matematikteki son 15 netten geldi.`,
    monthlyPrice: 4200,
    sessionPrice: 1250,
    maxActiveStudents: 5,
    activeEngagements: 5,
    ratingAvg: 4.8,
    ratingCount: 10,
    completedEngagements: 12,
    responseP50Seconds: 9000,
    cancellationRate: 0.03,
    availability: [[3, 'evening']],
    specializations: [{ label: 'İyi öğrenciyi ilk 2 bine taşıma', fromRank: 10_000, toRank: 2_000 }],
    reviewGains: [
      { rating: 5, gain: 14, body: 'Zaten iyiydim, son 15 neti onunla aldım.' },
      { rating: 4, gain: 11, body: 'Günlük takip yok, kendi disiplinin yoksa zorlanırsın.' },
    ],
  },
  {
    slug: 'defne-u',
    name: 'Defne U.',
    university: 'Boğaziçi Üniversitesi',
    department: 'Psikoloji',
    city: 'İstanbul',
    yksTrack: 'SOZEL',
    yksRank: 310,
    yksYear: 2023,
    ownBaselineNet: 70,
    ownFinalNet: 99,
    ownBaselineRank: 14_000,
    wasMezun: false,
    tracks: ['SOZEL'],
    subjects: ['Edebiyat', 'Tarih', 'Coğrafya', 'Felsefe'],
    styles: ['EMPATHETIC', 'STRATEGIC'],
    supportedGrades: ['GRADE_12', 'MEZUN'],
    headline: 'Sözelde ezber değil, kurgu. İlk 500’ün mantığı bu.',
    bio: `Sözel alanın en büyük yanlış anlaşılması "ezberleyince olur" fikri. Tarihte olayları tek tek ezberleyen öğrenci, soru biraz döndüğünde kayboluyor.\n\nBen bağlam kuruyorum: neden oldu, öncesinde ne vardı, sonrasını nasıl etkiledi. Felsefede de aynı yaklaşım.\n\n14 binden 310’a çıkışım bu yöntemle oldu. Psikoloji okuduğum için çalışma alışkanlığı kurma tarafında da destek olabiliyorum.`,
    monthlyPrice: 4800,
    sessionPrice: 1350,
    maxActiveStudents: 7,
    activeEngagements: 2,
    ratingAvg: 4.9,
    ratingCount: 14,
    completedEngagements: 16,
    responseP50Seconds: 2700,
    cancellationRate: 0.01,
    availability: [
      [2, 'afternoon'],
      [4, 'afternoon'],
      [6, 'evening'],
    ],
    specializations: [{ label: 'Sözelde ilk 500 hedefi', fromRank: 15_000, toRank: 500 }],
    reviewGains: [
      { rating: 5, gain: 25, body: 'Tarihi ezberlemeyi bıraktım, netim ikiye katlandı.' },
      { rating: 5, gain: 20, body: 'Felsefede hiç netim yoktu, 10 nete çıktım.' },
    ],
  },
  {
    slug: 'yusuf-a',
    name: 'Yusuf A.',
    university: 'İstanbul Üniversitesi',
    department: 'Türk Dili ve Edebiyatı',
    city: 'İstanbul',
    yksTrack: 'SOZEL',
    yksRank: 5_600,
    yksYear: 2024,
    ownBaselineNet: 55,
    ownFinalNet: 86,
    ownBaselineRank: 48_000,
    wasMezun: true,
    tracks: ['SOZEL', 'ESIT_AGIRLIK'],
    subjects: ['Edebiyat', 'TYT Türkçe', 'Tarih'],
    styles: ['STRICT', 'HIGH_TOUCH'],
    supportedGrades: ['MEZUN', 'GRADE_12'],
    headline: 'Paragrafta tıkanan herkesin sorunu aynı. Çözümü de aynı.',
    bio: `TYT Türkçe ve paragraf benim asıl işim. Edebiyat okuyorum ve paragraf sorusunun nasıl kurulduğunu sökebiliyorum.\n\nMezun yılımda 48 binden 5600’e çıktım, en büyük sıçrama Türkçeden geldi.\n\nSıkı çalışıyorum: her gün paragraf ödevi var ve kontrol ediyorum. Yapmadıysan görüşmede bunu konuşuruz.`,
    monthlyPrice: 2400,
    sessionPrice: 700,
    maxActiveStudents: 10,
    activeEngagements: 3,
    ratingAvg: 4.5,
    ratingCount: 8,
    completedEngagements: 9,
    responseP50Seconds: 5400,
    cancellationRate: 0.05,
    availability: [
      [1, 'morning'],
      [3, 'evening'],
      [5, 'morning'],
      [0, 'evening'],
    ],
    specializations: [{ label: 'TYT Türkçe ve paragraf sıçraması', fromRank: 60_000, toRank: 8_000 }],
    reviewGains: [
      { rating: 5, gain: 21, body: 'Paragrafta 12 netten 28 nete çıktım.' },
      { rating: 4, gain: 13, body: 'Ödev takibi çok sıkı, hazır ol.' },
    ],
  },
  {
    slug: 'nehir-k',
    name: 'Nehir K.',
    university: 'Dokuz Eylül Üniversitesi',
    department: 'Tarih',
    city: 'İzmir',
    yksTrack: 'SOZEL',
    yksRank: 31_000,
    yksYear: 2025,
    ownBaselineNet: 41,
    ownFinalNet: 68,
    ownBaselineRank: 110_000,
    wasMezun: false,
    tracks: ['SOZEL'],
    subjects: ['Tarih', 'Coğrafya', 'TYT Türkçe'],
    styles: ['EMPATHETIC'],
    supportedGrades: ['GRADE_11', 'GRADE_12'],
    headline: 'Sıfırdan başlıyorsan, acele etmeden kuralım.',
    bio: `110 binden 31 bine çıktım. Büyük bir sıçrama değil ama benim için çok şey ifade ediyordu ve o yolu adım adım biliyorum.\n\nÇok düşük netlerden başlayan, "ben yapamam" diyen öğrencilerle çalışmayı seviyorum. Baskı yapmıyorum; zaten yeterince baskı var.\n\nKaktüs’te yeniyim, fiyatım da buna göre.`,
    monthlyPrice: 1200,
    sessionPrice: 400,
    maxActiveStudents: 6,
    activeEngagements: 0,
    ratingAvg: 0,
    ratingCount: 0,
    completedEngagements: 0,
    responseP50Seconds: 1500,
    cancellationRate: 0,
    availability: [
      [2, 'morning'],
      [4, 'morning'],
      [6, 'afternoon'],
      [0, 'morning'],
    ],
    specializations: [],
    reviewGains: [],
  },
  {
    slug: 'deniz-p',
    name: 'Deniz P.',
    university: 'Boğaziçi Üniversitesi',
    department: 'İngiliz Dili ve Edebiyatı',
    city: 'İstanbul',
    yksTrack: 'DIL',
    yksRank: 180,
    yksYear: 2023,
    ownBaselineNet: 64,
    ownFinalNet: 94,
    ownBaselineRank: 8_000,
    wasMezun: false,
    tracks: ['DIL'],
    subjects: ['YDT İngilizce', 'TYT Türkçe'],
    styles: ['STRATEGIC', 'STRICT'],
    supportedGrades: ['GRADE_12', 'MEZUN'],
    headline: 'YDT’de ilk 200. Dil sınavı bir dil sınavı değil, bir strateji sınavı.',
    bio: `YDT’de 180. sıradayım. Dil alanında en sık gördüğüm hata, İngilizceyi "bilmek" ile sınavı çözmeyi karıştırmak. İkisi aynı şey değil.\n\nSoru tiplerini ayırıyoruz, her tip için ayrı yaklaşım kuruyoruz. Kelime çalışması da sistemli — rastgele liste ezberlemiyoruz.\n\nDil alanında koç bulmak zor, o yüzden kontenjanım hızlı doluyor.`,
    monthlyPrice: 5400,
    sessionPrice: 1500,
    maxActiveStudents: 6,
    activeEngagements: 4,
    ratingAvg: 5.0,
    ratingCount: 13,
    completedEngagements: 15,
    responseP50Seconds: 2100,
    cancellationRate: 0.01,
    availability: [
      [1, 'evening'],
      [3, 'afternoon'],
      [5, 'evening'],
    ],
    specializations: [{ label: 'YDT’de ilk 1000 hedefi', fromRank: 10_000, toRank: 1_000 }],
    reviewGains: [
      { rating: 5, gain: 23, body: 'Soru tiplerini ayırmak her şeyi değiştirdi.' },
      { rating: 5, gain: 19, body: 'Kelime çalışmasının sistemli olması çok işe yaradı.' },
    ],
  },
  {
    slug: 'melis-g',
    name: 'Melis G.',
    university: 'Bilkent Üniversitesi',
    department: 'Mütercim-Tercümanlık',
    city: 'Ankara',
    yksTrack: 'DIL',
    yksRank: 2_700,
    yksYear: 2024,
    ownBaselineNet: 57,
    ownFinalNet: 85,
    ownBaselineRank: 26_000,
    wasMezun: true,
    tracks: ['DIL'],
    subjects: ['YDT İngilizce'],
    styles: ['HIGH_TOUCH', 'EMPATHETIC'],
    supportedGrades: ['MEZUN', 'GRADE_12'],
    headline: 'Her gün 20 dakika. Dilde süreklilik her şeyden önemli.',
    bio: `Dil alanında haftada bir üç saat çalışmak, her gün yirmi dakika çalışmaktan daha az işe yarıyor. Bunu kendi mezun yılımda anladım.\n\nGünlük kısa görevler veriyorum ve her gün kontrol ediyorum. Uzun görüşmeler yapmıyoruz; onun yerine sürekli temas var.\n\n26 binden 2700’e bu şekilde çıktım.`,
    monthlyPrice: 2900,
    sessionPrice: 850,
    maxActiveStudents: 10,
    activeEngagements: 2,
    ratingAvg: 4.6,
    ratingCount: 7,
    completedEngagements: 8,
    responseP50Seconds: 1800,
    cancellationRate: 0.02,
    availability: [
      [1, 'morning'],
      [2, 'morning'],
      [3, 'morning'],
      [4, 'afternoon'],
      [6, 'evening'],
    ],
    specializations: [{ label: 'Mezun yılında YDT sıçraması', fromRank: 30_000, toRank: 3_000 }],
    reviewGains: [
      { rating: 5, gain: 20, body: 'Her gün kısa çalışma fikri gerçekten işe yarıyor.' },
      { rating: 4, gain: 12, body: 'Uzun görüşme isteyenler için uygun değil.' },
    ],
  },
];

// ─────────────────────────────────────────────────────────────────────────────

async function wipeSeedData() {
  const users = await prisma.user.findMany({
    where: { email: { endsWith: `@${SEED_DOMAIN}` } },
    select: { id: true, coachProfile: { select: { id: true } }, studentProfile: { select: { id: true } } },
  });
  if (users.length === 0) return 0;

  const coachIds = users.map((u) => u.coachProfile?.id).filter((id): id is string => Boolean(id));
  const studentIds = users.map((u) => u.studentProfile?.id).filter((id): id is string => Boolean(id));
  const scope = {
    OR: [
      { coachProfileId: { in: coachIds } },
      { studentProfileId: { in: studentIds } },
    ],
  };

  // Order matters: Engagement holds Restrict references from Offer and the
  // profiles, so the dependents must go first or the delete is rejected.
  const engagements = await prisma.engagement.findMany({ where: scope, select: { id: true } });
  const engagementIds = engagements.map((e) => e.id);

  await prisma.review.deleteMany({ where: { engagementId: { in: engagementIds } } });
  await prisma.booking.deleteMany({ where: scope });
  await prisma.milestone.deleteMany({ where: { engagementId: { in: engagementIds } } });
  await prisma.dispute.deleteMany({ where: { engagementId: { in: engagementIds } } });
  await prisma.refund.deleteMany({ where: { engagementId: { in: engagementIds } } });
  await prisma.engagement.deleteMany({ where: { id: { in: engagementIds } } });

  const offers = await prisma.offer.findMany({ where: scope, select: { id: true } });
  await prisma.offerEvent.deleteMany({ where: { offerId: { in: offers.map((o) => o.id) } } });
  await prisma.payment.deleteMany({ where: { offerId: { in: offers.map((o) => o.id) } } });
  await prisma.slotHold.deleteMany({ where: scope });
  await prisma.offer.deleteMany({ where: { id: { in: offers.map((o) => o.id) } } });
  await prisma.conversation.deleteMany({ where: scope });

  await prisma.user.deleteMany({ where: { id: { in: users.map((u) => u.id) } } });
  return users.length;
}

/** Next occurrence of a weekday, at a fixed local hour, in the future. */
function pastDate(daysAgo: number, hour: number): Date {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - daysAgo);
  date.setUTCHours(hour - 3, 0, 0, 0); // Europe/Istanbul is UTC+3 year-round
  return date;
}

async function main() {
  console.log('Seeding…\n');

  const removed = await wipeSeedData();
  if (removed > 0) console.log(`  removed ${removed} previously seeded users\n`);

  // Commission policy. The offer service falls back to 1800 bps without one,
  // but seeding it means the admin UI and any future rate change have a row to
  // point at rather than a hardcoded default.
  const policyCount = await prisma.commissionPolicy.count();
  if (policyCount === 0) {
    await prisma.commissionPolicy.create({
      data: { name: 'Varsayılan', defaultBps: 1800, minBps: 1000, maxBps: 2500 },
    });
    console.log('  created default commission policy (18%)\n');
  }

  // Past students who leave the reviews. Kept separate from the demo student so
  // review history cannot be confused with an account you are testing with.
  const reviewerCount = 6;
  const reviewers = [];
  for (let i = 0; i < reviewerCount; i++) {
    const user = await prisma.user.create({
      data: {
        email: `gecmis-ogrenci-${i}@${SEED_DOMAIN}`,
        name: ['Ada Y.', 'Ege T.', 'Zeynep B.', 'Arda K.', 'Lara M.', 'Efe S.'][i],
        roles: ['STUDENT'],
        emailVerified: new Date(),
      },
    });
    const profile = await prisma.studentProfile.create({
      data: { userId: user.id, track: 'SAYISAL', gradeLevel: 'MEZUN' },
    });
    reviewers.push(profile);
  }

  let coachNumber = 0;
  for (const seed of COACHES) {
    coachNumber++;

    const user = await prisma.user.create({
      data: {
        email: `${seed.slug}@${SEED_DOMAIN}`,
        name: seed.name,
        roles: ['COACH'],
        emailVerified: new Date(),
        timezone: TZ,
      },
    });

    const coach = await prisma.coachProfile.create({
      data: {
        userId: user.id,
        slug: seed.slug,
        headline: seed.headline,
        bio: seed.bio,
        city: seed.city,
        timezone: TZ,
        university: seed.university,
        department: seed.department,
        graduationYear: seed.yksYear + 4,
        yksRank: seed.yksRank,
        yksYear: seed.yksYear,
        yksTrack: seed.yksTrack,
        ownBaselineNet: seed.ownBaselineNet,
        ownFinalNet: seed.ownFinalNet,
        ownBaselineRank: seed.ownBaselineRank,
        wasMezun: seed.wasMezun,
        tracks: seed.tracks,
        subjects: seed.subjects,
        styles: seed.styles,
        supportedGrades: seed.supportedGrades,
        maxActiveStudents: seed.maxActiveStudents,
        activeEngagements: seed.activeEngagements,
        weeklyCapacityHours: seed.availability.length * 3,
        acceptingStudents: true,
        ratingAvg: seed.ratingAvg,
        ratingCount: seed.ratingCount,
        completedEngagements: seed.completedEngagements,
        responseP50Seconds: seed.responseP50Seconds,
        cancellationRate: seed.cancellationRate,
        // Approved AND payout-ready. Either one missing makes the coach
        // useless for testing — invisible in search, or blocked at payment.
        verificationStatus: 'APPROVED',
        verifiedAt: new Date(),
        submerchantKey: `mock_sub_seed_${seed.slug}`,
        payoutReadyAt: new Date(),
        lastActiveAt: new Date(),
      },
    });

    await prisma.availabilityRule.createMany({
      data: seed.availability.map(([weekday, block]) => ({
        coachProfileId: coach.id,
        weekday,
        startMinute: BLOCKS[block][0],
        endMinute: BLOCKS[block][1],
        timezone: TZ,
        active: true,
      })),
    });

    await prisma.pricingTier.createMany({
      data: [
        {
          coachProfileId: coach.id,
          name: 'Aylık program',
          cadence: 'MONTHLY_STANDARD',
          priceMinor: seed.monthlyPrice * 100,
          sessionsPerCycle: 4,
          minutesPerSession: 60,
          includesMessaging: true,
          sortOrder: 0,
        },
        {
          coachProfileId: coach.id,
          name: 'Tanışma seansı',
          cadence: 'SINGLE_SESSION',
          priceMinor: seed.sessionPrice * 100,
          sessionsPerCycle: 1,
          minutesPerSession: 60,
          includesMessaging: false,
          sortOrder: 1,
        },
      ],
    });

    if (seed.specializations.length > 0) {
      await prisma.coachSpecialization.createMany({
        data: seed.specializations.map((spec, index) => ({
          coachProfileId: coach.id,
          label: spec.label,
          slug: `${seed.slug}-uzmanlik-${index}`,
          fromRank: spec.fromRank,
          toRank: spec.toRank,
        })),
      });
    }

    await prisma.verificationDocument.create({
      data: {
        coachProfileId: coach.id,
        type: 'YKS_RESULT',
        storageKey: `seed/verification/${seed.slug}-osym.pdf`,
        mimeType: 'application/pdf',
        sizeBytes: 184_320,
        status: 'APPROVED',
        reviewedAt: new Date(),
      },
    });

    // Completed history, so reviews and the reported-net-gain signal are real
    // rows rather than a number typed into a column.
    for (const [index, review] of seed.reviewGains.entries()) {
      const reviewer = reviewers[(coachNumber + index) % reviewers.length];
      const startedDaysAgo = 140 - index * 35;

      const conversation = await prisma.conversation.create({
        data: { coachProfileId: coach.id, studentProfileId: reviewer.id },
      });

      const price = seed.monthlyPrice * 100;
      const offer = await prisma.offer.create({
        data: {
          conversationId: conversation.id,
          coachProfileId: coach.id,
          studentProfileId: reviewer.id,
          initiatorRole: 'STUDENT',
          title: 'Aylık program',
          scope: {
            cadence: 'MONTHLY_STANDARD',
            sessionsPerCycle: 4,
            minutesPerSession: 60,
            weeks: 4,
            includesMessaging: true,
            deliverables: [],
            slots: [],
          } as Prisma.InputJsonValue,
          priceMinor: price,
          commissionBps: 1800,
          startDate: pastDate(startedDaysAgo, 18),
          endDate: pastDate(startedDaysAgo - 28, 19),
          milestoneCount: 4,
          status: 'COMPLETED',
          expiresAt: pastDate(startedDaysAgo + 2, 18),
          acceptedAt: pastDate(startedDaysAgo + 1, 18),
        },
      });

      const engagement = await prisma.engagement.create({
        data: {
          offerId: offer.id,
          coachProfileId: coach.id,
          studentProfileId: reviewer.id,
          status: 'COMPLETED',
          startDate: offer.startDate,
          endDate: offer.endDate,
          totalMinor: price,
          commissionBps: 1800,
          completedAt: offer.endDate,
        },
      });

      const per = Math.floor(price / 4);
      await prisma.milestone.createMany({
        data: Array.from({ length: 4 }, (_, m) => ({
          engagementId: engagement.id,
          index: m,
          periodStart: pastDate(startedDaysAgo - m * 7, 18),
          periodEnd: pastDate(startedDaysAgo - (m + 1) * 7, 18),
          amountMinor: m === 0 ? price - per * 3 : per,
          status: 'RELEASED' as const,
          releasedAt: pastDate(startedDaysAgo - (m + 1) * 7, 20),
        })),
      });

      await prisma.review.create({
        data: {
          engagementId: engagement.id,
          coachProfileId: coach.id,
          studentProfileId: reviewer.id,
          rating: review.rating,
          body: review.body,
          netGainReported: review.gain,
          published: true,
          createdAt: pastDate(startedDaysAgo - 30, 12),
        },
      });
    }

    console.log(
      `  ${String(coachNumber).padStart(2)}. ${seed.name.padEnd(12)} ${seed.yksTrack.padEnd(13)} ` +
        `${String(seed.yksRank).padStart(6)}.  ${String(seed.monthlyPrice).padStart(5)} ₺/ay  ` +
        `${seed.availability.length} blok  ${seed.reviewGains.length} yorum`,
    );
  }

  // A student account you can sign into and immediately see matches with.
  const studentUser = await prisma.user.create({
    data: {
      email: `ogrenci@${SEED_DOMAIN}`,
      name: 'Test Öğrenci',
      roles: ['STUDENT'],
      emailVerified: new Date(),
      timezone: TZ,
    },
  });
  await prisma.studentProfile.create({
    data: {
      userId: studentUser.id,
      track: 'SAYISAL',
      gradeLevel: 'MEZUN',
      baselineTytNet: 55,
      baselineAytNet: 18,
      targetRanking: 5_000,
      targetUniversity: 'Boğaziçi Üniversitesi',
      targetDepartment: 'Bilgisayar Mühendisliği',
      preferredStyles: ['STRICT', 'STRATEGIC'],
      // Without this the availability signal sits neutral for every coach and
      // the calendar-overlap part of matching is never exercised — which is
      // easy to miss, because the results still look plausible.
      availability: [
        { weekday: 1, startMinute: 18 * 60, endMinute: 22 * 60 },
        { weekday: 2, startMinute: 18 * 60, endMinute: 22 * 60 },
        { weekday: 3, startMinute: 18 * 60, endMinute: 22 * 60 },
        { weekday: 4, startMinute: 18 * 60, endMinute: 22 * 60 },
        { weekday: 6, startMinute: 9 * 60, endMinute: 12 * 60 },
      ] as Prisma.InputJsonValue,
      budgetMinMinor: 200_000,
      budgetMaxMinor: 500_000,
      budgetCadence: 'MONTHLY_STANDARD',
      weeklyHoursGoal: 3,
    },
  });

  console.log(`\n  ${COACHES.length} koç, ${reviewerCount} geçmiş öğrenci, 1 test öğrencisi.`);
  console.log(`\n  Giriş için: ogrenci@${SEED_DOMAIN}`);
  console.log('  (magic link konsola düşer; ya da kendi hesabınla gir.)\n');
  console.log('  Admin olmak için:');
  console.log(`    UPDATE "User" SET roles = '{STUDENT,ADMIN}' WHERE email = 'senin@epostan.com';\n`);
}

main()
  .catch((error) => {
    console.error('\nSeed failed:\n', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
