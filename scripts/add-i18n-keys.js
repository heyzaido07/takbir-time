/**
 * One-shot: add translations for the home-screen-handoff + topbar-polish keys
 * (next.reminders/at/allTimesToday/colJamat/colStarts/colEnds/timesCaption/
 *  tag/prayersWord/switch, nav.go, qaza.pill, lang.eyebrow/choose) into every
 * locale bundle. English lives in js/i18n.js and is intentionally not a file.
 *
 * Run from repo root:  node scripts/add-i18n-keys.js
 */
const fs = require('fs');
const path = require('path');

const T = {
  ar: {
    'next.reminders': 'تذكيرات',
    'next.at': 'في',
    'next.allTimesToday': 'كل أوقات التكبير · اليوم',
    'next.colJamat': 'الجماعة',
    'next.colStarts': 'يبدأ',
    'next.colEnds': 'ينتهي',
    'next.timesCaption': '<strong>الجماعة</strong> = وقت الجماعة المُعلن · يبدأ/ينتهي = نافذة وضع الشمس لهذا المسجد.',
    'next.tag': 'التالي',
    'next.prayersWord': 'صلوات',
    'next.switch': 'تبديل',
    'nav.go': 'اذهب',
    'qaza.pill': 'متتبّع قضاء الصلاة',
    'lang.eyebrow': 'اللغة',
    'lang.choose': 'اختر لغتك',
  },
  ur: {
    'next.reminders': 'یاد دہانیاں',
    'next.at': 'بوقت',
    'next.allTimesToday': 'تمام تکبیر اوقات · آج',
    'next.colJamat': 'جماعت',
    'next.colStarts': 'شروع',
    'next.colEnds': 'اختتام',
    'next.timesCaption': '<strong>جماعت</strong> = اعلان شدہ جماعت کا وقت · شروع/اختتام = اس مسجد کے لیے سورج کی پوزیشن کا وقفہ۔',
    'next.tag': 'اگلی',
    'next.prayersWord': 'نمازیں',
    'next.switch': 'تبدیل کریں',
    'nav.go': 'جائیں',
    'qaza.pill': 'قضا نماز ٹریکر',
    'lang.eyebrow': 'زبان',
    'lang.choose': 'اپنی زبان منتخب کریں',
  },
  id: {
    'next.reminders': 'Pengingat',
    'next.at': 'pukul',
    'next.allTimesToday': 'Semua waktu takbir · hari ini',
    'next.colJamat': 'Jamaah',
    'next.colStarts': 'Mulai',
    'next.colEnds': 'Selesai',
    'next.timesCaption': '<strong>Jamaah</strong> = waktu jamaah yang diumumkan · Mulai/Selesai = rentang posisi matahari untuk masjid ini.',
    'next.tag': 'Berikutnya',
    'next.prayersWord': 'salat',
    'next.switch': 'Ganti',
    'nav.go': 'Pergi',
    'qaza.pill': 'Pelacak Salat Qaza',
    'lang.eyebrow': 'Bahasa',
    'lang.choose': 'Pilih bahasa Anda',
  },
  bn: {
    'next.reminders': 'অনুস্মারক',
    'next.at': 'সময়',
    'next.allTimesToday': 'সব তাকবির সময় · আজ',
    'next.colJamat': 'জামাত',
    'next.colStarts': 'শুরু',
    'next.colEnds': 'শেষ',
    'next.timesCaption': '<strong>জামাত</strong> = ঘোষিত জামাতের সময় · শুরু/শেষ = এই মসজিদের জন্য সূর্যের অবস্থানের সময়সীমা।',
    'next.tag': 'পরবর্তী',
    'next.prayersWord': 'নামাজ',
    'next.switch': 'পরিবর্তন',
    'nav.go': 'যান',
    'qaza.pill': 'কাজা নামাজ ট্র্যাকার',
    'lang.eyebrow': 'ভাষা',
    'lang.choose': 'আপনার ভাষা নির্বাচন করুন',
  },
  hi: {
    'next.reminders': 'अनुस्मारक',
    'next.at': 'समय',
    'next.allTimesToday': 'सभी तकबीर समय · आज',
    'next.colJamat': 'जमात',
    'next.colStarts': 'शुरू',
    'next.colEnds': 'समाप्त',
    'next.timesCaption': '<strong>जमात</strong> = घोषित जमात समय · शुरू/समाप्त = इस मस्जिद के लिए सूर्य-स्थिति अवधि।',
    'next.tag': 'अगला',
    'next.prayersWord': 'नमाज़',
    'next.switch': 'बदलें',
    'nav.go': 'जाएँ',
    'qaza.pill': 'क़ज़ा नमाज़ ट्रैकर',
    'lang.eyebrow': 'भाषा',
    'lang.choose': 'अपनी भाषा चुनें',
  },
  tr: {
    'next.reminders': 'Hatırlatıcılar',
    'next.at': 'saat',
    'next.allTimesToday': 'Tüm tekbir vakitleri · bugün',
    'next.colJamat': 'Cemaat',
    'next.colStarts': 'Başlangıç',
    'next.colEnds': 'Bitiş',
    'next.timesCaption': '<strong>Cemaat</strong> = duyurulan cemaat vakti · Başlangıç/Bitiş = bu cami için güneş konumu aralığı.',
    'next.tag': 'Sonraki',
    'next.prayersWord': 'namaz',
    'next.switch': 'Değiştir',
    'nav.go': 'Git',
    'qaza.pill': 'Kaza Namazı Takipçisi',
    'lang.eyebrow': 'Dil',
    'lang.choose': 'Dilinizi seçin',
  },
  fa: {
    'next.reminders': 'یادآوری‌ها',
    'next.at': 'ساعت',
    'next.allTimesToday': 'همهٔ اوقات تکبیر · امروز',
    'next.colJamat': 'جماعت',
    'next.colStarts': 'شروع',
    'next.colEnds': 'پایان',
    'next.timesCaption': '<strong>جماعت</strong> = زمان اعلام‌شدهٔ جماعت · شروع/پایان = بازهٔ موقعیت خورشید برای این مسجد.',
    'next.tag': 'بعدی',
    'next.prayersWord': 'نماز',
    'next.switch': 'تغییر',
    'nav.go': 'برو',
    'qaza.pill': 'ردیاب نماز قضا',
    'lang.eyebrow': 'زبان',
    'lang.choose': 'زبان خود را انتخاب کنید',
  },
  ms: {
    'next.reminders': 'Peringatan',
    'next.at': 'pada',
    'next.allTimesToday': 'Semua waktu takbir · hari ini',
    'next.colJamat': 'Jemaah',
    'next.colStarts': 'Mula',
    'next.colEnds': 'Tamat',
    'next.timesCaption': '<strong>Jemaah</strong> = waktu jemaah yang diumumkan · Mula/Tamat = julat kedudukan matahari untuk masjid ini.',
    'next.tag': 'Seterusnya',
    'next.prayersWord': 'solat',
    'next.switch': 'Tukar',
    'nav.go': 'Pergi',
    'qaza.pill': 'Penjejak Solat Qada',
    'lang.eyebrow': 'Bahasa',
    'lang.choose': 'Pilih bahasa anda',
  },
  fr: {
    'next.reminders': 'Rappels',
    'next.at': 'à',
    'next.allTimesToday': 'Tous les horaires de takbir · aujourd’hui',
    'next.colJamat': 'Jamat',
    'next.colStarts': 'Début',
    'next.colEnds': 'Fin',
    'next.timesCaption': '<strong>Jamat</strong> = heure de prière en congrégation annoncée · Début/Fin = créneau de position solaire pour cette mosquée.',
    'next.tag': 'Suivant',
    'next.prayersWord': 'prières',
    'next.switch': 'Changer',
    'nav.go': 'Aller',
    'qaza.pill': 'Suivi des prières Qaza',
    'lang.eyebrow': 'Langue',
    'lang.choose': 'Choisissez votre langue',
  },
};

const dir = path.join(__dirname, '..', 'i18n');
for (const [code, additions] of Object.entries(T)) {
  const file = path.join(dir, `${code}.json`);
  const obj = JSON.parse(fs.readFileSync(file, 'utf8'));
  let added = 0;
  for (const [k, v] of Object.entries(additions)) {
    if (obj[k] !== v) added += 1;
    obj[k] = v;
  }
  fs.writeFileSync(file, JSON.stringify(obj, null, 2) + '\n', 'utf8');
  console.log(`${code}.json: ${added} keys set (${Object.keys(additions).length} total)`);
}
console.log('Done.');
