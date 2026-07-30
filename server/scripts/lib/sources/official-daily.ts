/**
 * Official daily prayer-time sources.
 *
 * These sources publish official prayer-start timetables for a country,
 * city, emirate, or prayer zone. They are intentionally not treated as
 * mosque-admin iqamah/jamaat sources. Each submission is credited to the
 * relevant public time keeper and carries an explicit note about that scope.
 */

import https from 'https';
import {
  DIYANET_AWQAT_SCRAPER_IDENTITY,
  IACAD_DUBAI_SCRAPER_IDENTITY,
  JAKIM_ESOLAT_SCRAPER_IDENTITY,
  KEMENAG_BIMAS_SCRAPER_IDENTITY,
  LocalMosque,
  MOROCCO_HABOUS_SCRAPER_IDENTITY,
  MUIS_SCRAPER_IDENTITY,
  OtherTimings,
  ScraperSource,
  SourceMatch,
  USER_AGENT,
  VAKTIJA_BA_SCRAPER_IDENTITY,
  fetchJson,
  fetchText,
  normalizeName,
  normalizeTime,
} from '../jummah-import-core';

type OfficialSourceOptions = {
  timeoutMs?: number;
};

type DailyPrayer = Exclude<keyof OtherTimings, 'maghribOffset'>;

const OFFICIAL_DAILY_NOTE =
  'Official daily prayer-start timetable; not a mosque-specific iqamah/jamaat schedule.';

const DAILY_PRAYERS: DailyPrayer[] = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'];

function countryMatches(local: LocalMosque, values: string[]): boolean {
  const country = normalizeName(local.country);
  return values.some(value => {
    const expected = normalizeName(value);
    return country === expected || country.includes(expected);
  });
}

function localText(local: LocalMosque): string {
  return normalizeName(
    [local.name, local.city, local.stateProvince, local.postalCode, local.country]
      .filter(Boolean)
      .join(' '),
  );
}

function cleanTimings(raw: OtherTimings): OtherTimings {
  const out: OtherTimings = {};
  for (const prayer of DAILY_PRAYERS) {
    const time = normalizeTime(raw[prayer]);
    if (time) out[prayer] = time;
  }
  if (typeof raw.maghribOffset === 'number' && Number.isFinite(raw.maghribOffset)) {
    out.maghribOffset = raw.maghribOffset;
  }
  return out;
}

function hasDailyTimings(timings: OtherTimings): boolean {
  return DAILY_PRAYERS.some(prayer => !!timings[prayer]) || timings.maghribOffset != null;
}

function officialMatch(args: {
  sourceName: string;
  sourceUrl: string;
  sourceMosqueName: string;
  sourceMosqueId?: string | number;
  timings: OtherTimings;
  extraNotes?: string[];
}): SourceMatch | null {
  const otherTimings = cleanTimings(args.timings);
  if (!hasDailyTimings(otherTimings)) return null;
  return {
    sourceName: args.sourceName,
    sourceUrl: args.sourceUrl,
    websiteUrl: null,
    sourceMosqueName: args.sourceMosqueName,
    sourceMosqueId: args.sourceMosqueId,
    matchScore: 1,
    jummah: [],
    otherTimings,
    extraNotes: [OFFICIAL_DAILY_NOTE, ...(args.extraNotes || [])],
  };
}

function dateParts(timeZone: string): { year: number; month: number; day: number; iso: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
    .formatToParts(new Date())
    .reduce<Record<string, string>>((acc, part) => {
      if (part.type !== 'literal') acc[part.type] = part.value;
      return acc;
    }, {});
  const year = Number(parts.year);
  const month = Number(parts.month);
  const day = Number(parts.day);
  return {
    year,
    month,
    day,
    iso: `${parts.year}-${parts.month}-${parts.day}`,
  };
}

function mmddyyyy(parts: { year: number; month: number; day: number }): string {
  return `${String(parts.month).padStart(2, '0')}/${String(parts.day).padStart(2, '0')}/${parts.year}`;
}

function decodeHtml(value: string): string {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)));
}

function cleanPlace(value: string | null | undefined): string {
  return normalizeName(value || '')
    .replace(/\b(kabupaten|kab|kota|city|district|province|provinsi|wilayah)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ---------------------------------------------------------------------------
// Malaysia - JAKIM e-Solat
// ---------------------------------------------------------------------------

type JakimPrayerTime = {
  zone?: string;
  imsak?: string;
  fajr?: string;
  syuruk?: string;
  dhuhr?: string;
  asr?: string;
  maghrib?: string;
  isha?: string;
};

type JakimResponse = {
  prayerTime?: JakimPrayerTime[];
};

const JAKIM_SOURCE_NAME = 'JAKIM e-Solat';
const JAKIM_API_ROOT = 'https://www.e-solat.gov.my/index.php?r=esolatApi/TakwimSolat';

const JAKIM_ZONES: Array<{ zone: string; aliases: string[] }> = [
  { zone: 'WLY01', aliases: ['kuala lumpur', 'putrajaya', 'wilayah persekutuan kuala lumpur'] },
  { zone: 'WLY02', aliases: ['labuan', 'wilayah persekutuan labuan'] },
  { zone: 'JHR02', aliases: ['johor bahru', 'kota tinggi', 'mersing'] },
  { zone: 'SGR01', aliases: ['gombak', 'petaling', 'sepang', 'hulu langat', 'hulu selangor', 'shah alam', 'rawang', 'kajang', 'petaling jaya', 'subang jaya', 'puchong', 'batu caves', 'semenyih', 'dengkil', 'bandar baru bangi'] },
  { zone: 'SGR02', aliases: ['kuala selangor', 'sabak bernam', 'sekinchan'] },
  { zone: 'SGR03', aliases: ['klang', 'kuala langat', 'banting', 'telok panglima garang'] },
  { zone: 'PNG01', aliases: ['pulau pinang', 'penang', 'george town', 'butterworth'] },
  { zone: 'MLK01', aliases: ['melaka', 'malacca'] },
  { zone: 'NSN01', aliases: ['seremban', 'port dickson', 'rembau', 'jelebu', 'kuala pilah'] },
  { zone: 'PHG02', aliases: ['kuantan', 'pekan', 'rompin', 'muadzam shah'] },
  { zone: 'KTN01', aliases: ['kota bharu', 'bachok', 'pasir puteh', 'tumpat', 'pasir mas'] },
  { zone: 'TRG01', aliases: ['kuala terengganu', 'marang', 'kuala nerus'] },
  { zone: 'PRK02', aliases: ['ipoh', 'batu gajah', 'kampar', 'sungai siput', 'kuala kangsar'] },
  { zone: 'KDH01', aliases: ['kota setar', 'kubang pasu', 'pokok sena', 'alor setar'] },
  { zone: 'SWK07', aliases: ['kuching', 'bau', 'lundu', 'sematan'] },
  { zone: 'SWK08', aliases: ['miri', 'niah', 'sibuti', 'bekenu', 'marudi'] },
  { zone: 'SBH07', aliases: ['kota kinabalu', 'penampang', 'tuaran', 'ranau', 'kota belud'] },
];

function jakimZoneFor(local: LocalMosque): string | null {
  const haystack = localText(local);
  for (const row of JAKIM_ZONES) {
    if (row.aliases.some(alias => haystack.includes(normalizeName(alias)))) return row.zone;
  }
  return null;
}

export function extractJakimTimings(row: JakimPrayerTime): OtherTimings {
  return {
    fajr: normalizeTime(row.fajr) || undefined,
    dhuhr: normalizeTime(row.dhuhr) || undefined,
    asr: normalizeTime(row.asr) || undefined,
    maghrib: normalizeTime(row.maghrib) || undefined,
    isha: normalizeTime(row.isha) || undefined,
  };
}

export function createJakimESolatSource(opts: OfficialSourceOptions = {}): ScraperSource {
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const cache = new Map<string, Promise<JakimPrayerTime | null>>();

  async function fetchZone(zone: string): Promise<JakimPrayerTime | null> {
    const url = `${JAKIM_API_ROOT}&period=today&zone=${encodeURIComponent(zone)}`;
    const json = await fetchJson<JakimResponse>(url, undefined, timeoutMs);
    return json.prayerTime?.[0] || null;
  }

  return {
    name: JAKIM_SOURCE_NAME,
    scraperUser: JAKIM_ESOLAT_SCRAPER_IDENTITY,

    async findMatch(local: LocalMosque): Promise<SourceMatch | null> {
      if (!countryMatches(local, ['Malaysia'])) return null;
      const zone = jakimZoneFor(local);
      if (!zone) return null;
      cache.set(zone, cache.get(zone) || fetchZone(zone));
      const row = await cache.get(zone)!;
      if (!row) return null;
      const sourceUrl = `${JAKIM_API_ROOT}&period=today&zone=${encodeURIComponent(zone)}`;
      return officialMatch({
        sourceName: JAKIM_SOURCE_NAME,
        sourceUrl,
        sourceMosqueName: `Malaysia prayer zone ${zone}`,
        sourceMosqueId: zone,
        timings: extractJakimTimings(row),
        extraNotes: [`JAKIM e-Solat zone: ${zone}.`],
      });
    },
  };
}

// ---------------------------------------------------------------------------
// Singapore - MUIS through data.gov.sg official dataset
// ---------------------------------------------------------------------------

type MuisRecord = {
  Date?: string;
  Day?: string;
  Subuh?: string;
  Syuruk?: string;
  Zohor?: string;
  Asar?: string;
  Maghrib?: string;
  Isyak?: string;
};

type MuisResponse = {
  result?: {
    records?: MuisRecord[];
  };
};

const MUIS_SOURCE_NAME = 'MUIS';
const MUIS_DATASTORE_URL = 'https://data.gov.sg/api/action/datastore_search';
const MUIS_RESOURCE_ID =
  process.env.MUIS_DATA_GOV_RESOURCE_ID || 'd_a6a206cba471fe04b62dd886ef5eaf22';

export function extractMuisTimings(row: MuisRecord): OtherTimings {
  return {
    fajr: normalizeTime(row.Subuh) || undefined,
    dhuhr: normalizeTime(row.Zohor) || undefined,
    asr: normalizeTime(row.Asar) || undefined,
    maghrib: normalizeTime(row.Maghrib) || undefined,
    isha: normalizeTime(row.Isyak) || undefined,
  };
}

export function createMuisSource(opts: OfficialSourceOptions = {}): ScraperSource {
  const timeoutMs = opts.timeoutMs ?? 15_000;
  let todayPromise: Promise<MuisRecord | null> | null = null;

  async function fetchToday(): Promise<MuisRecord | null> {
    const date = dateParts('Asia/Singapore').iso;
    const params = new URLSearchParams({
      resource_id: MUIS_RESOURCE_ID,
      filters: JSON.stringify({ Date: date }),
      limit: '1',
    });
    const json = await fetchJson<MuisResponse>(`${MUIS_DATASTORE_URL}?${params}`, undefined, timeoutMs);
    return json.result?.records?.[0] || null;
  }

  return {
    name: MUIS_SOURCE_NAME,
    scraperUser: MUIS_SCRAPER_IDENTITY,

    async findMatch(local: LocalMosque): Promise<SourceMatch | null> {
      if (!countryMatches(local, ['Singapore'])) return null;
      todayPromise ||= fetchToday();
      const row = await todayPromise;
      if (!row) return null;
      return officialMatch({
        sourceName: MUIS_SOURCE_NAME,
        sourceUrl: `https://data.gov.sg/datasets?resultId=${MUIS_RESOURCE_ID}`,
        sourceMosqueName: 'Singapore',
        sourceMosqueId: row.Date,
        timings: extractMuisTimings(row),
        extraNotes: [`MUIS/data.gov.sg date: ${row.Date || dateParts('Asia/Singapore').iso}.`],
      });
    },
  };
}

// ---------------------------------------------------------------------------
// Bosnia and Sandzak - Vaktija.ba
// ---------------------------------------------------------------------------

type VaktijaToday = {
  id?: number;
  lokacija?: string;
  datum?: string[];
  vakat?: string[];
};

const VAKTIJA_SOURCE_NAME = 'Vaktija.ba';
const VAKTIJA_API_ROOT = 'https://api.vaktija.ba/vaktija/v1';
const VAKTIJA_COUNTRIES = ['Bosnia and Herzegovina', 'Serbia', 'Montenegro'];

export function extractVaktijaTimings(vakat: string[] | undefined): OtherTimings {
  if (!Array.isArray(vakat)) return {};
  return {
    fajr: normalizeTime(vakat[0]) || undefined,
    dhuhr: normalizeTime(vakat[2]) || undefined,
    asr: normalizeTime(vakat[3]) || undefined,
    maghrib: normalizeTime(vakat[4]) || undefined,
    isha: normalizeTime(vakat[5]) || undefined,
  };
}

function bestVaktijaLocationId(local: LocalMosque, locations: string[]): number | null {
  const city = cleanPlace(local.city);
  const state = cleanPlace(local.stateProvince);
  const haystack = localText(local);
  let best: { id: number; score: number } | null = null;

  for (let id = 0; id < locations.length; id++) {
    const key = cleanPlace(locations[id]);
    if (!key) continue;
    let score = 0;
    if (city && key === city) score = 1;
    else if (state && key === state) score = 0.95;
    else if (city && (key.includes(city) || city.includes(key))) score = 0.78;
    else if (haystack.includes(key)) score = 0.7;
    if (!best || score > best.score) best = { id, score };
  }

  return best && best.score >= 0.7 ? best.id : null;
}

export function createVaktijaBaSource(opts: OfficialSourceOptions = {}): ScraperSource {
  const timeoutMs = opts.timeoutMs ?? 15_000;
  let locationsPromise: Promise<string[]> | null = null;
  const dayCache = new Map<number, Promise<VaktijaToday | null>>();

  async function locations(): Promise<string[]> {
    locationsPromise ||= fetchJson<string[]>(`${VAKTIJA_API_ROOT}/lokacije`, undefined, timeoutMs);
    return locationsPromise;
  }

  async function fetchLocation(id: number): Promise<VaktijaToday | null> {
    const parts = dateParts('Europe/Sarajevo');
    const url = `${VAKTIJA_API_ROOT}/${id}/${parts.year}/${parts.month}/${parts.day}`;
    return fetchJson<VaktijaToday>(url, undefined, timeoutMs);
  }

  return {
    name: VAKTIJA_SOURCE_NAME,
    scraperUser: VAKTIJA_BA_SCRAPER_IDENTITY,

    async findMatch(local: LocalMosque): Promise<SourceMatch | null> {
      if (!countryMatches(local, VAKTIJA_COUNTRIES)) return null;
      const id = bestVaktijaLocationId(local, await locations());
      if (id == null) return null;
      dayCache.set(id, dayCache.get(id) || fetchLocation(id));
      const row = await dayCache.get(id)!;
      if (!row) return null;
      return officialMatch({
        sourceName: VAKTIJA_SOURCE_NAME,
        sourceUrl: `${VAKTIJA_API_ROOT}/${id}`,
        sourceMosqueName: row.lokacija || `Vaktija location ${id}`,
        sourceMosqueId: id,
        timings: extractVaktijaTimings(row.vakat),
        extraNotes: [`Vaktija location: ${row.lokacija || id}.`],
      });
    },
  };
}

// ---------------------------------------------------------------------------
// Dubai - IACAD
// ---------------------------------------------------------------------------

type IacadPrayerRow = {
  City?: string;
  CityE?: string;
  Date?: string;
  Fajr?: string;
  Shorooq?: string;
  Duhr?: string;
  Asr?: string;
  Maghrib?: string;
  Isha?: string;
};

type IacadResponse = {
  code?: number;
  data?: Array<{
    Country?: {
      NameE?: string;
      Pray?: IacadPrayerRow[];
    };
  }>;
};

const IACAD_SOURCE_NAME = 'Dubai IACAD';
const IACAD_PAGE_URL = 'https://iacad.gov.ae/en/prayer-times';
const IACAD_API_URL = 'https://iacad.gov.ae/api/PublicApi/GeIntegrationResult';

export function extractIacadTimings(row: IacadPrayerRow): OtherTimings {
  return {
    fajr: normalizeTime(row.Fajr) || undefined,
    dhuhr: normalizeTime(row.Duhr) || undefined,
    asr: normalizeTime(row.Asr) || undefined,
    maghrib: normalizeTime(row.Maghrib) || undefined,
    isha: normalizeTime(row.Isha) || undefined,
  };
}

function isDubai(local: LocalMosque): boolean {
  if (!countryMatches(local, ['United Arab Emirates', 'UAE'])) return false;
  const text = localText(local);
  return text.includes('dubai') || text.includes('dubayy');
}

function findIacadRow(json: IacadResponse): IacadPrayerRow | null {
  const target = mmddyyyy(dateParts('Asia/Dubai'));
  const unpadded = target.replace(/^0/, '').replace('/0', '/');
  for (const item of json.data || []) {
    for (const row of item.Country?.Pray || []) {
      if (row.Date === target || row.Date === unpadded) return row;
    }
  }
  return null;
}

export function createIacadDubaiSource(opts: OfficialSourceOptions = {}): ScraperSource {
  const timeoutMs = opts.timeoutMs ?? 15_000;
  let todayPromise: Promise<IacadPrayerRow | null> | null = null;

  async function fetchToday(): Promise<IacadPrayerRow | null> {
    const json = await fetchJson<IacadResponse>(
      IACAD_API_URL,
      {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Origin: 'https://iacad.gov.ae',
          Referer: IACAD_PAGE_URL,
        },
        body: JSON.stringify({ integrationId: 1 }),
      },
      timeoutMs,
    );
    return findIacadRow(json);
  }

  return {
    name: IACAD_SOURCE_NAME,
    scraperUser: IACAD_DUBAI_SCRAPER_IDENTITY,

    async findMatch(local: LocalMosque): Promise<SourceMatch | null> {
      if (!isDubai(local)) return null;
      todayPromise ||= fetchToday();
      const row = await todayPromise;
      if (!row) return null;
      return officialMatch({
        sourceName: IACAD_SOURCE_NAME,
        sourceUrl: IACAD_PAGE_URL,
        sourceMosqueName: row.CityE || row.City || 'Dubai City',
        sourceMosqueId: row.Date,
        timings: extractIacadTimings(row),
        extraNotes: [
          'Dubai emirate prayer timetable from IACAD; other UAE emirates may have different official timetables.',
          `IACAD date: ${row.Date || mmddyyyy(dateParts('Asia/Dubai'))}.`,
        ],
      });
    },
  };
}

// ---------------------------------------------------------------------------
// Morocco - Ministry of Habous and Islamic Affairs
// ---------------------------------------------------------------------------

const HABOUS_SOURCE_NAME = 'Morocco Habous';
const HABOUS_URL = 'https://www.habous.gov.ma/prieres/horaire-api.php';

const HABOUS_CITIES: Array<{ id: number; aliases: string[] }> = [
  { id: 1, aliases: ['rabat'] },
  { id: 2, aliases: ['khemisset', 'khmissat'] },
  { id: 7, aliases: ['kenitra', 'al qnitra'] },
  { id: 14, aliases: ['tangier', 'tanger', 'tanja'] },
  { id: 15, aliases: ['tetouan', 'tetuan'] },
  { id: 16, aliases: ['larache'] },
  { id: 18, aliases: ['chefchaouen', 'chaouen'] },
  { id: 31, aliases: ['oujda'] },
  { id: 32, aliases: ['berkane'] },
  { id: 39, aliases: ['nador'] },
  { id: 58, aliases: ['casablanca', 'dar el beida', 'casa'] },
  { id: 59, aliases: ['mohammedia'] },
  { id: 66, aliases: ['el jadida', 'jadida'] },
  { id: 73, aliases: ['beni mellal', 'bni mellal'] },
  { id: 79, aliases: ['khouribga'] },
  { id: 81, aliases: ['fes', 'fez', 'fès'] },
  { id: 89, aliases: ['taza'] },
  { id: 99, aliases: ['meknes', 'meknès'] },
  { id: 103, aliases: ['azrou'] },
  { id: 104, aliases: ['marrakech', 'marrakesh'] },
  { id: 106, aliases: ['essaouira'] },
  { id: 111, aliases: ['safi'] },
  { id: 117, aliases: ['agadir'] },
  { id: 118, aliases: ['taroudant'] },
  { id: 119, aliases: ['tiznit'] },
  { id: 128, aliases: ['errachidia', 'rachidia'] },
  { id: 149, aliases: ['guelmim'] },
  { id: 156, aliases: ['laayoune', 'el aaiun'] },
  { id: 165, aliases: ['dakhla'] },
];

function habousCityFor(local: LocalMosque): { id: number; label: string } | null {
  const haystack = localText(local);
  for (const row of HABOUS_CITIES) {
    const alias = row.aliases.find(value => haystack.includes(normalizeName(value)));
    if (alias) return { id: row.id, label: alias };
  }
  return null;
}

function fetchHabousText(url: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      {
        timeout: timeoutMs,
        headers: { 'User-Agent': USER_AGENT },
        // habous.gov.ma currently serves an incomplete chain in some clients.
        agent: new https.Agent({ rejectUnauthorized: false }),
      },
      res => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', chunk => {
          data += chunk;
        });
        res.on('end', () => {
          const status = res.statusCode || 0;
          if (status < 200 || status >= 300) reject(new Error(`Habous returned HTTP ${status}`));
          else resolve(data);
        });
      },
    );
    req.on('timeout', () => {
      req.destroy(new Error(`Habous timed out after ${timeoutMs}ms`));
    });
    req.on('error', reject);
    req.end();
  });
}

function timeAfterArabicLabel(html: string, label: string): string | undefined {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = html.match(new RegExp(`${escaped}[\\s\\S]{0,180}?(\\d{1,2}:\\d{2})`, 'u'));
  return match?.[1];
}

export function extractHabousTimings(html: string): OtherTimings {
  return {
    fajr: normalizeTime(timeAfterArabicLabel(html, 'الفجر')) || undefined,
    dhuhr: normalizeTime(timeAfterArabicLabel(html, 'الظهر')) || undefined,
    asr: normalizeTime(timeAfterArabicLabel(html, 'العصر')) || undefined,
    maghrib: normalizeTime(timeAfterArabicLabel(html, 'المغرب')) || undefined,
    isha: normalizeTime(timeAfterArabicLabel(html, 'العشاء')) || undefined,
  };
}

export function createMoroccoHabousSource(opts: OfficialSourceOptions = {}): ScraperSource {
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const cache = new Map<number, Promise<string>>();

  return {
    name: HABOUS_SOURCE_NAME,
    scraperUser: MOROCCO_HABOUS_SCRAPER_IDENTITY,

    async findMatch(local: LocalMosque): Promise<SourceMatch | null> {
      if (!countryMatches(local, ['Morocco'])) return null;
      const city = habousCityFor(local);
      if (!city) return null;
      const sourceUrl = `${HABOUS_URL}?ville=${city.id}`;
      cache.set(city.id, cache.get(city.id) || fetchHabousText(sourceUrl, timeoutMs));
      const html = await cache.get(city.id)!;
      return officialMatch({
        sourceName: HABOUS_SOURCE_NAME,
        sourceUrl,
        sourceMosqueName: city.label,
        sourceMosqueId: city.id,
        timings: extractHabousTimings(html),
        extraNotes: [`Morocco Habous city id: ${city.id}.`],
      });
    },
  };
}

// ---------------------------------------------------------------------------
// Turkey - Diyanet Namaz Vakitleri
// ---------------------------------------------------------------------------

type DiyanetState = {
  SehirAdi?: string;
  SehirAdiEn?: string;
  SehirID?: string;
};

type DiyanetDistrict = {
  IlceUrl?: string;
  IlceAdi?: string;
  IlceAdiEn?: string;
  IlceID?: string;
};

type DiyanetRegListResponse = {
  StateList?: DiyanetState[];
  StateRegionList?: DiyanetDistrict[];
};

const DIYANET_SOURCE_NAME = 'Diyanet Awqat Salah';
const DIYANET_ROOT = 'https://namazvakitleri.diyanet.gov.tr';
const DIYANET_REG_LIST = `${DIYANET_ROOT}/tr-TR/home/GetRegList`;
const DIYANET_TURKEY_COUNTRY_ID = '2';

export function extractDiyanetTimings(html: string): OtherTimings {
  const value = (key: string) =>
    normalizeTime(html.match(new RegExp(`var\\s+_${key}Time\\s*=\\s*["']([^"']+)["']`, 'i'))?.[1]);
  return {
    fajr: value('imsak') || undefined,
    dhuhr: value('ogle') || undefined,
    asr: value('ikindi') || undefined,
    maghrib: value('aksam') || undefined,
    isha: value('yatsi') || undefined,
  };
}

function diyanetPlaceCandidates(local: LocalMosque): string[] {
  return [local.city, local.stateProvince, local.name]
    .filter((value): value is string => !!value)
    .flatMap(value => value.split(/[\/,;-]/g))
    .map(cleanPlace)
    .filter(Boolean);
}

function findDiyanetState(local: LocalMosque, states: DiyanetState[]): DiyanetState | null {
  const candidates = diyanetPlaceCandidates(local);
  for (const candidate of candidates) {
    const exact = states.find(state => {
      const keys = [state.SehirAdi, state.SehirAdiEn].map(cleanPlace);
      return keys.includes(candidate);
    });
    if (exact) return exact;
  }
  return null;
}

function findDiyanetDistrict(
  local: LocalMosque,
  state: DiyanetState,
  districts: DiyanetDistrict[],
): DiyanetDistrict | null {
  const candidates = diyanetPlaceCandidates(local);
  for (const candidate of candidates) {
    const exact = districts.find(district => {
      const keys = [district.IlceAdi, district.IlceAdiEn].map(cleanPlace);
      return keys.includes(candidate);
    });
    if (exact) return exact;
  }

  const stateKey = cleanPlace(state.SehirAdiEn || state.SehirAdi);
  return (
    districts.find(district => {
      const keys = [district.IlceAdi, district.IlceAdiEn].map(cleanPlace);
      return keys.includes(stateKey);
    }) ||
    districts[0] ||
    null
  );
}

export function createDiyanetSource(opts: OfficialSourceOptions = {}): ScraperSource {
  const timeoutMs = opts.timeoutMs ?? 15_000;
  let statesPromise: Promise<DiyanetState[]> | null = null;
  const districtsCache = new Map<string, Promise<DiyanetDistrict[]>>();
  const pageCache = new Map<string, Promise<string>>();

  async function states(): Promise<DiyanetState[]> {
    if (!statesPromise) {
      const params = new URLSearchParams({
        ChangeType: 'country',
        CountryId: DIYANET_TURKEY_COUNTRY_ID,
        Culture: 'tr-TR',
      });
      statesPromise = fetchJson<DiyanetRegListResponse>(`${DIYANET_REG_LIST}?${params}`, undefined, timeoutMs)
        .then(json => json.StateList || []);
    }
    return statesPromise;
  }

  async function districts(stateId: string): Promise<DiyanetDistrict[]> {
    if (!districtsCache.has(stateId)) {
      const params = new URLSearchParams({
        ChangeType: 'state',
        CountryId: DIYANET_TURKEY_COUNTRY_ID,
        StateId: stateId,
        Culture: 'tr-TR',
      });
      districtsCache.set(
        stateId,
        fetchJson<DiyanetRegListResponse>(`${DIYANET_REG_LIST}?${params}`, undefined, timeoutMs)
          .then(json => json.StateRegionList || []),
      );
    }
    return districtsCache.get(stateId)!;
  }

  return {
    name: DIYANET_SOURCE_NAME,
    scraperUser: DIYANET_AWQAT_SCRAPER_IDENTITY,

    async findMatch(local: LocalMosque): Promise<SourceMatch | null> {
      if (!countryMatches(local, ['Turkey', 'Turkiye', 'Türkiye'])) return null;
      const state = findDiyanetState(local, await states());
      if (!state?.SehirID) return null;
      const district = findDiyanetDistrict(local, state, await districts(state.SehirID));
      if (!district?.IlceUrl) return null;
      const pageUrl = new URL(district.IlceUrl, DIYANET_ROOT).toString();
      pageCache.set(pageUrl, pageCache.get(pageUrl) || fetchText(pageUrl, timeoutMs));
      const html = await pageCache.get(pageUrl)!;
      return officialMatch({
        sourceName: DIYANET_SOURCE_NAME,
        sourceUrl: pageUrl,
        sourceMosqueName: district.IlceAdiEn || district.IlceAdi || state.SehirAdiEn || 'Turkey',
        sourceMosqueId: district.IlceID,
        timings: extractDiyanetTimings(html),
        extraNotes: [
          `Diyanet city: ${state.SehirAdiEn || state.SehirAdi || state.SehirID}; district: ${district.IlceAdiEn || district.IlceAdi || district.IlceID}.`,
        ],
      });
    },
  };
}

// ---------------------------------------------------------------------------
// Indonesia - Kemenag/Bimas Islam data through EQuran public endpoint
// ---------------------------------------------------------------------------

type KemenagKabKotaResponse = {
  code?: number;
  data?: string[];
};

type KemenagScheduleRow = {
  tanggal?: number;
  tanggal_lengkap?: string;
  hari?: string;
  imsak?: string;
  subuh?: string;
  terbit?: string;
  dhuha?: string;
  dzuhur?: string;
  ashar?: string;
  maghrib?: string;
  isya?: string;
};

type KemenagScheduleResponse = {
  code?: number;
  data?: {
    provinsi?: string;
    kabkota?: string;
    jadwal?: KemenagScheduleRow[];
  };
};

type KemenagLocation = {
  province: string;
  kabkota: string;
  key: string;
  isKota: boolean;
  isKabupaten: boolean;
};

const KEMENAG_SOURCE_NAME = 'Kemenag Bimas Islam';
const EQURAN_ROOT = 'https://equran.id/api/v2';
const EQURAN_DOCS_URL = 'https://equran.id/apidev/shalat';

function cleanKemenagPlace(value: string | null | undefined): string {
  const key = cleanPlace(value)
    .replace(/\bdki\b/g, ' ')
    .replace(/\bdaerah khusus ibukota\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return key === 'jakarta raya' ? 'jakarta' : key;
}

export function extractKemenagTimings(row: KemenagScheduleRow): OtherTimings {
  return {
    fajr: normalizeTime(row.subuh) || undefined,
    dhuhr: normalizeTime(row.dzuhur) || undefined,
    asr: normalizeTime(row.ashar) || undefined,
    maghrib: normalizeTime(row.maghrib) || undefined,
    isha: normalizeTime(row.isya) || undefined,
  };
}

function selectKemenagLocation(local: LocalMosque, locations: KemenagLocation[]): KemenagLocation | null {
  const rawCity = normalizeName(local.city);
  if (!rawCity || rawCity === 'unknown') return null;
  const cityKey = cleanKemenagPlace(local.city);
  const wantsKabupaten = /\bkabupaten\b|\bkab\b/i.test(local.city);
  const wantsKota = /\bkota\b/i.test(local.city);
  const provinceKey = cleanPlace(local.stateProvince);

  const matches = locations.filter(loc => loc.key === cityKey);
  if (matches.length === 0) return null;
  if (provinceKey) {
    const provinceMatch = matches.find(loc => cleanPlace(loc.province) === provinceKey);
    if (provinceMatch) return provinceMatch;
  }
  if (wantsKabupaten) return matches.find(loc => loc.isKabupaten) || matches[0];
  if (wantsKota) return matches.find(loc => loc.isKota) || matches[0];
  return matches.find(loc => loc.isKota) || matches[0];
}

export function createKemenagBimasSource(opts: OfficialSourceOptions = {}): ScraperSource {
  const timeoutMs = opts.timeoutMs ?? 20_000;
  let locationsPromise: Promise<KemenagLocation[]> | null = null;
  const scheduleCache = new Map<string, Promise<KemenagScheduleRow | null>>();

  async function loadLocations(): Promise<KemenagLocation[]> {
    if (!locationsPromise) {
      locationsPromise = (async () => {
        const provinces = await fetchJson<{ data?: string[] }>(`${EQURAN_ROOT}/shalat/provinsi`, undefined, timeoutMs);
        const out: KemenagLocation[] = [];
        for (const province of provinces.data || []) {
          const json = await fetchJson<KemenagKabKotaResponse>(
            `${EQURAN_ROOT}/shalat/kabkota`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
              body: JSON.stringify({ provinsi: province }),
            },
            timeoutMs,
          );
          for (const kabkota of json.data || []) {
            out.push({
              province,
              kabkota,
              key: cleanKemenagPlace(kabkota),
              isKota: /^kota\b/i.test(kabkota),
              isKabupaten: /^kab\./i.test(kabkota) || /^kabupaten\b/i.test(kabkota),
            });
          }
        }
        return out;
      })();
    }
    return locationsPromise;
  }

  async function fetchToday(location: KemenagLocation): Promise<KemenagScheduleRow | null> {
    const parts = dateParts('Asia/Jakarta');
    const json = await fetchJson<KemenagScheduleResponse>(
      `${EQURAN_ROOT}/shalat`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          provinsi: location.province,
          kabkota: location.kabkota,
          bulan: parts.month,
          tahun: parts.year,
        }),
      },
      timeoutMs,
    );
    return (json.data?.jadwal || []).find(row => row.tanggal_lengkap === parts.iso) || null;
  }

  return {
    name: KEMENAG_SOURCE_NAME,
    scraperUser: KEMENAG_BIMAS_SCRAPER_IDENTITY,

    async findMatch(local: LocalMosque): Promise<SourceMatch | null> {
      if (!countryMatches(local, ['Indonesia'])) return null;
      const location = selectKemenagLocation(local, await loadLocations());
      if (!location) return null;
      const key = `${location.province}:${location.kabkota}`;
      scheduleCache.set(key, scheduleCache.get(key) || fetchToday(location));
      const row = await scheduleCache.get(key)!;
      if (!row) return null;
      return officialMatch({
        sourceName: KEMENAG_SOURCE_NAME,
        sourceUrl: EQURAN_DOCS_URL,
        sourceMosqueName: `${location.kabkota}, ${location.province}`,
        sourceMosqueId: key,
        timings: extractKemenagTimings(row),
        extraNotes: [
          'Fetched through EQuran public shalat endpoint, which documents Bimas Islam Kementerian Agama RI as the data source.',
          `Kemenag location: ${location.kabkota}, ${location.province}; date: ${row.tanggal_lengkap || dateParts('Asia/Jakarta').iso}.`,
        ],
      });
    },
  };
}
