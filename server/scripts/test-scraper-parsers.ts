import assert from 'assert';
import {
  extractFivePrayersTimings,
  parseFivePrayersDirectory,
} from './lib/sources/fiveprayers';
import { extractMosqueHqTimings } from './lib/sources/mosquehq';
import {
  extractDiyanetTimings,
  extractHabousTimings,
  extractIacadTimings,
  extractJakimTimings,
  extractKemenagTimings,
  extractMuisTimings,
  extractVaktijaTimings,
} from './lib/sources/official-daily';

function testFivePrayersDirectory() {
  const entries = parseFivePrayersDirectory(`
    <select>
      <option value="none">...</option>
      <option value="MECenter">Muslim Education Center. Charlotte, NC </option>
      <option value="test_home">Home. Test, XX </option>
      <option value="masjidbilal">Masjid Bilal. Toms River, New Jersey </option>
    </select>
  `);
  assert.deepStrictEqual(entries.map(e => e.id), ['MECenter', 'masjidbilal']);
  assert.strictEqual(entries[0].name, 'Muslim Education Center');
  assert.strictEqual(entries[0].location, 'Charlotte, NC');
}

function testFivePrayersTimings() {
  const timings = extractFivePrayersTimings(`
    <div id="logoBox">Muslim Education Center</div>
    <div id="dateBox">Charlotte, NC</div>
    <td id='fajIq'>5:20 <span>AM</span></td>
    <td id='dhuIq'>1:45 <span>PM</span></td>
    <td id='asrIq'>5:30 <span>PM</span></td>
    <td id='magIq'>5:05 <span>PM</span></td>
    <td id='ishIq'>8:45 <span>PM</span></td>
    <td id="fdp">1:15 <span>PM</span></td>
    <span id="parms">35.227085,-80.843124,,15,15,0</span>
  `);
  assert.strictEqual(timings.mosqueName, 'Muslim Education Center');
  assert.strictEqual(timings.latitude, 35.227085);
  assert.strictEqual(timings.longitude, -80.843124);
  assert.deepStrictEqual(timings.jummah, ['13:15']);
  assert.deepStrictEqual(timings.otherTimings, {
    fajr: '05:20',
    dhuhr: '13:45',
    asr: '17:30',
    maghrib: '17:05',
    isha: '20:45',
  });
}

function testMosqueHqTimings() {
  const timings = extractMosqueHqTimings(`
    <title> Islamic Society of Mobile  | MosqueHQ</title>
    <script>
      var today_iqamah = ['05:10 AM','01:15 PM','04:45 PM','07:45 PM','09:00 PM'];
      var mosque_settings = {"jummah_adhan_time":["01:15 PM"],"jummah_iqamah_time":["01:45 PM"]};
      mosque_settings.timezone = "US/Central";
    </script>
    <table><tr><td>Jummah</td><td>01:15 PM</td><td>01:45 PM</td></tr></table>
  `);
  assert.strictEqual(timings.mosqueName, 'Islamic Society of Mobile');
  assert.strictEqual(timings.timezone, 'US/Central');
  assert.deepStrictEqual(timings.jummah, ['13:45']);
  assert.deepStrictEqual(timings.otherTimings, {
    fajr: '05:10',
    dhuhr: '13:15',
    asr: '16:45',
    maghrib: '19:45',
    isha: '21:00',
  });
}

function testOfficialDailyTimings() {
  assert.deepStrictEqual(
    extractJakimTimings({
      fajr: '05:50:00',
      dhuhr: '13:12:00',
      asr: '16:34:00',
      maghrib: '19:20:00',
      isha: '20:33:00',
    }),
    {
      fajr: '05:50',
      dhuhr: '13:12',
      asr: '16:34',
      maghrib: '19:20',
      isha: '20:33',
    },
  );

  assert.deepStrictEqual(
    extractMuisTimings({
      Subuh: '5:35 AM',
      Zohor: '1:07 PM',
      Asar: '4:30 PM',
      Maghrib: '7:06 PM',
      Isyak: '8:19 PM',
    }),
    {
      fajr: '05:35',
      dhuhr: '13:07',
      asr: '16:30',
      maghrib: '19:06',
      isha: '20:19',
    },
  );

  assert.deepStrictEqual(extractVaktijaTimings(['3:17', '5:15', '12:44', '16:44', '20:11', '21:51']), {
    fajr: '03:17',
    dhuhr: '12:44',
    asr: '16:44',
    maghrib: '20:11',
    isha: '21:51',
  });

  assert.deepStrictEqual(
    extractIacadTimings({
      Fajr: '04:20:00',
      Duhr: '12:19:00',
      Asr: '15:45:00',
      Maghrib: '18:53:00',
      Isha: '20:12:00',
    }),
    {
      fajr: '04:20',
      dhuhr: '12:19',
      asr: '15:45',
      maghrib: '18:53',
      isha: '20:12',
    },
  );

  assert.deepStrictEqual(
    extractHabousTimings(`
      <td>الفجر : </td><td>04:44</td>
      <td>الظهر : </td><td>13:29 </td>
      <td>العصر : </td><td>17:08</td>
      <td>المغرب : </td><td>20:25</td>
      <td>العشاء :</td><td> 21:52</td>
    `),
    {
      fajr: '04:44',
      dhuhr: '13:29',
      asr: '17:08',
      maghrib: '20:25',
      isha: '21:52',
    },
  );

  assert.deepStrictEqual(
    extractDiyanetTimings(`
      var _imsakTime = "03:44";
      var _gunesTime = "05:27";
      var _ogleTime = "12:50";
      var _ikindiTime = "16:43";
      var _aksamTime = "20:03";
      var _yatsiTime = "21:39";
    `),
    {
      fajr: '03:44',
      dhuhr: '12:50',
      asr: '16:43',
      maghrib: '20:03',
      isha: '21:39',
    },
  );

  assert.deepStrictEqual(
    extractKemenagTimings({
      subuh: '04:35',
      dzuhur: '11:53',
      ashar: '15:14',
      maghrib: '17:47',
      isya: '18:59',
    }),
    {
      fajr: '04:35',
      dhuhr: '11:53',
      asr: '15:14',
      maghrib: '17:47',
      isha: '18:59',
    },
  );
}

testFivePrayersDirectory();
testFivePrayersTimings();
testMosqueHqTimings();
testOfficialDailyTimings();
console.log('scraper parser tests passed');
