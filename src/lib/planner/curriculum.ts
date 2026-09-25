/**
 * YKS subjects and their main topics, for the study planner's pickers.
 *
 * The headline units of the current ÖSYM/MEB syllabus, not an exhaustive
 * breakdown: enough that a coach can pick "AYT Matematik → Türev" in two taps,
 * with free text always available for anything finer or missing. When the
 * resource catalog arrives (phase 2), it keys off these same subject names.
 */

export type ExamPartCode = 'TYT' | 'AYT' | 'YDT';

export interface Subject {
  name: string;
  topics: string[];
}

export const CURRICULUM: Record<ExamPartCode, Subject[]> = {
  TYT: [
    {
      name: 'Türkçe',
      topics: [
        'Sözcükte Anlam', 'Cümlede Anlam', 'Paragraf', 'Ses Bilgisi', 'Yazım Kuralları',
        'Noktalama İşaretleri', 'Sözcükte Yapı', 'İsimler', 'Sıfatlar', 'Zamirler', 'Zarflar',
        'Edat, Bağlaç, Ünlem', 'Fiiller', 'Ek Fiil', 'Fiilimsiler', 'Cümlenin Ögeleri',
        'Cümle Türleri', 'Anlatım Bozuklukları',
      ],
    },
    {
      name: 'Matematik',
      topics: [
        'Temel Kavramlar', 'Sayı Basamakları', 'Bölme ve Bölünebilme', 'EBOB - EKOK',
        'Rasyonel Sayılar', 'Basit Eşitsizlikler', 'Mutlak Değer', 'Üslü Sayılar', 'Köklü Sayılar',
        'Çarpanlara Ayırma', 'Oran - Orantı', 'Denklem Çözme', 'Sayı Problemleri',
        'Kesir Problemleri', 'Yaş Problemleri', 'Yüzde, Kâr - Zarar Problemleri',
        'Karışım Problemleri', 'Hareket Problemleri', 'İşçi Problemleri', 'Grafik Problemleri',
        'Kümeler', 'Mantık', 'Fonksiyonlar', 'Permütasyon - Kombinasyon', 'Olasılık',
        'Veri ve İstatistik', 'Polinomlar', '2. Dereceden Denklemler',
      ],
    },
    {
      name: 'Geometri',
      topics: [
        'Doğruda ve Üçgende Açılar', 'Dik Üçgen', 'İkizkenar ve Eşkenar Üçgen', 'Üçgende Alan',
        'Açıortay ve Kenarortay', 'Üçgende Benzerlik', 'Çokgenler', 'Dörtgenler',
        'Çember ve Daire', 'Katı Cisimler', 'Noktanın ve Doğrunun Analitiği',
      ],
    },
    {
      name: 'Fizik',
      topics: [
        'Fizik Bilimine Giriş', 'Madde ve Özellikleri', 'Hareket ve Kuvvet', 'İş, Güç, Enerji',
        'Isı ve Sıcaklık', 'Elektrostatik', 'Elektrik Akımı', 'Manyetizma', 'Basınç',
        'Kaldırma Kuvveti', 'Dalgalar', 'Optik',
      ],
    },
    {
      name: 'Kimya',
      topics: [
        'Kimya Bilimi', 'Atom ve Periyodik Sistem', 'Kimyasal Türler Arası Etkileşimler',
        'Maddenin Halleri', 'Doğa ve Kimya', 'Kimyanın Temel Kanunları', 'Mol Kavramı',
        'Kimyasal Tepkimeler', 'Karışımlar', 'Asitler, Bazlar ve Tuzlar', 'Kimya Her Yerde',
      ],
    },
    {
      name: 'Biyoloji',
      topics: [
        'Canlıların Ortak Özellikleri', 'Canlıların Temel Bileşenleri', 'Hücre',
        'Canlıların Sınıflandırılması', 'Hücre Bölünmeleri', 'Kalıtım', 'Ekosistem Ekolojisi',
        'Güncel Çevre Sorunları',
      ],
    },
    {
      name: 'Tarih',
      topics: [
        'Tarih Bilimi', 'İlk Çağ Uygarlıkları', 'İlk Türk Devletleri', 'İslam Tarihi',
        'Türk - İslam Devletleri', 'Osmanlı Kuruluş ve Yükselme', 'Osmanlı Duraklama ve Gerileme',
        'Osmanlı Dağılma Dönemi', '20. Yüzyıl Başlarında Osmanlı', 'Kurtuluş Savaşı',
        'Atatürk İlke ve İnkılapları',
      ],
    },
    {
      name: 'Coğrafya',
      topics: [
        'Doğa ve İnsan', 'Dünya’nın Şekli ve Hareketleri', 'Harita Bilgisi', 'İklim Bilgisi',
        'İç ve Dış Kuvvetler', 'Nüfus', 'Göç', 'Yerleşme', 'Türkiye’nin Yer Şekilleri',
        'Ekonomik Faaliyetler', 'Bölgeler', 'Doğal Afetler',
      ],
    },
    {
      name: 'Felsefe',
      topics: [
        'Felsefeye Giriş', 'Bilgi Felsefesi', 'Varlık Felsefesi', 'Ahlak Felsefesi',
        'Sanat Felsefesi', 'Din Felsefesi', 'Siyaset Felsefesi', 'Bilim Felsefesi',
      ],
    },
    {
      name: 'Din Kültürü',
      topics: [
        'Bilgi ve İnanç', 'Din ve İslam', 'İslam ve İbadet', 'Gençlik ve Değerler',
        'Allah - İnsan İlişkisi', 'Hz. Muhammed', 'Vahiy ve Akıl',
      ],
    },
  ],
  AYT: [
    {
      name: 'Matematik',
      topics: [
        'Fonksiyonlar', 'Polinomlar', '2. Dereceden Denklemler', 'Eşitsizlikler', 'Parabol',
        'Trigonometri', 'Logaritma', 'Diziler', 'Limit ve Süreklilik', 'Türev', 'İntegral',
        'Permütasyon - Kombinasyon - Binom', 'Olasılık', 'Karmaşık Sayılar',
      ],
    },
    {
      name: 'Geometri',
      topics: [
        'Üçgenler', 'Çokgenler ve Dörtgenler', 'Çember ve Daire', 'Analitik Geometri',
        'Çemberin Analitik İncelemesi', 'Dönüşüm Geometrisi', 'Katı Cisimler',
      ],
    },
    {
      name: 'Fizik',
      topics: [
        'Vektörler', 'Bağıl Hareket', 'Newton’un Hareket Yasaları', 'Atışlar', 'İş, Güç, Enerji',
        'İtme ve Momentum', 'Tork ve Denge', 'Kütle Merkezi', 'Basit Makineler',
        'Elektrik Alan ve Potansiyel', 'Manyetizma ve İndüksiyon', 'Alternatif Akım',
        'Çembersel Hareket', 'Basit Harmonik Hareket', 'Dalga Mekaniği', 'Atom Fiziği',
        'Modern Fizik',
      ],
    },
    {
      name: 'Kimya',
      topics: [
        'Modern Atom Teorisi', 'Gazlar', 'Sıvı Çözeltiler', 'Kimyasal Tepkimelerde Enerji',
        'Tepkime Hızı', 'Kimyasal Denge', 'Asit - Baz Dengesi', 'Çözünürlük Dengesi',
        'Kimya ve Elektrik', 'Karbon Kimyasına Giriş', 'Organik Bileşikler', 'Enerji Kaynakları',
      ],
    },
    {
      name: 'Biyoloji',
      topics: [
        'Sinir Sistemi', 'Endokrin Sistem', 'Duyu Organları', 'Destek ve Hareket Sistemi',
        'Sindirim Sistemi', 'Dolaşım ve Bağışıklık', 'Solunum Sistemi', 'Boşaltım Sistemi',
        'Üreme Sistemi', 'Komünite ve Popülasyon Ekolojisi', 'Nükleik Asitler ve Protein Sentezi',
        'Canlılık ve Enerji', 'Fotosentez ve Kemosentez', 'Hücresel Solunum', 'Bitki Biyolojisi',
      ],
    },
    {
      name: 'Türk Dili ve Edebiyatı',
      topics: [
        'Şiir Bilgisi', 'Edebi Sanatlar', 'İslamiyet Öncesi ve Geçiş Dönemi', 'Divan Edebiyatı',
        'Halk Edebiyatı', 'Tanzimat Edebiyatı', 'Servet-i Fünun', 'Fecr-i Âti', 'Milli Edebiyat',
        'Cumhuriyet Dönemi', 'Edebi Akımlar', 'Dünya Edebiyatı',
      ],
    },
    {
      name: 'Tarih',
      topics: [
        'Tarih ve Zaman', 'İlk ve Orta Çağlarda Türk Dünyası', 'Türklerin İslamiyeti Kabulü',
        'Osmanlı Siyaseti', 'Osmanlı Kültür ve Medeniyeti', 'Değişen Dünya Dengeleri',
        'Uluslararası İlişkilerde Denge Stratejisi', 'Milli Mücadele', 'Atatürkçülük',
        'İki Savaş Arası Dönem', 'II. Dünya Savaşı', 'Soğuk Savaş Dönemi', 'Küreselleşen Dünya',
      ],
    },
    {
      name: 'Coğrafya',
      topics: [
        'Ekosistem', 'Nüfus Politikaları', 'Türkiye’de Nüfus ve Yerleşme', 'Ekonomik Faaliyetler',
        'Türkiye Ekonomisi', 'Bölgesel Kalkınma Projeleri', 'Küresel Ticaret', 'Kültür Bölgeleri',
        'Jeopolitik Konum', 'Çevre ve Toplum', 'Doğal Kaynaklar',
      ],
    },
    {
      name: 'Felsefe Grubu',
      topics: ['Mantık', 'Psikoloji', 'Sosyoloji', 'Felsefe Tarihi'],
    },
    {
      name: 'Din Kültürü',
      topics: ['Dünya ve Ahiret', 'Kur’an’a Göre Hz. Muhammed', 'İslam Düşüncesinde Yorumlar', 'Yaşayan Dinler'],
    },
  ],
  YDT: [
    {
      name: 'İngilizce',
      topics: [
        'Kelime Bilgisi', 'Dil Bilgisi', 'Cloze Test', 'Cümle Tamamlama', 'Çeviri',
        'Okuma Parçası', 'Diyalog Tamamlama', 'Anlamca Yakın Cümle', 'Paragraf Tamamlama',
        'Anlam Bütünlüğünü Bozan Cümle',
      ],
    },
    { name: 'Almanca', topics: [] },
    { name: 'Fransızca', topics: [] },
    { name: 'Arapça', topics: [] },
    { name: 'Rusça', topics: [] },
  ],
};

export const TASK_KIND_LABELS = {
  KONU_ANLATIMI: 'Konu anlatımı',
  SORU_BANKASI: 'Soru bankası',
  BRANS_DENEMESI: 'Branş denemesi',
  GENEL_DENEME: 'Genel deneme',
  TEKRAR: 'Tekrar',
  DIGER: 'Diğer',
} as const;

export const TASK_UNIT_LABELS = {
  SORU: 'soru',
  TEST: 'test',
  DAKIKA: 'dk',
  SAYFA: 'sayfa',
  VIDEO: 'video',
} as const;

export type TaskKindCode = keyof typeof TASK_KIND_LABELS;
export type TaskUnitCode = keyof typeof TASK_UNIT_LABELS;
