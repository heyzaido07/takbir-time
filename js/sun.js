// ═══════════════════════════════════════════════════════════════════
// Astronomical sunset computation — used to derive Maghrib time.
//
// Maghrib is tied to actual sunset, which changes daily and depends on
// the mosque's exact location. Hard-coding submitted Maghrib times is
// wrong for any deploy that lives more than a week. We compute the real
// astronomical sunset on demand from the mosque's lat/lng and today's
// date.
//
// Algorithm: NOAA Solar Position Algorithm, simplified. Accurate to ~1
// minute, which is well within the "azan" precision Muslims actually use.
// ═══════════════════════════════════════════════════════════════════

const sun = (() => {
  const D2R = Math.PI / 180;
  const R2D = 180 / Math.PI;

  /**
   * Returns the sunset Date object for the given coords on the given
   * date (or today). Returns null at extreme latitudes during polar
   * day/night, when no sunset occurs.
   */
  function sunsetForCoords(lat, lng, dateOverride) {
    if (lat == null || lng == null) return null;
    const date = dateOverride || new Date();

    // Julian date for 0h UT of the date
    const localMidnight = new Date(date);
    localMidnight.setUTCHours(0, 0, 0, 0);
    const jd = (localMidnight.getTime() / 86400000) + 2440587.5;
    const jc = (jd - 2451545) / 36525;

    let geomMeanLongSun = (280.46646 + jc * (36000.76983 + 0.0003032 * jc)) % 360;
    if (geomMeanLongSun < 0) geomMeanLongSun += 360;

    const geomMeanAnomSun = 357.52911 + jc * (35999.05029 - 0.0001537 * jc);
    const eccentEarthOrbit = 0.016708634 - jc * (0.000042037 + 0.0000001267 * jc);

    const sunEqOfCtr =
      Math.sin(D2R * geomMeanAnomSun) * (1.914602 - jc * (0.004817 + 0.000014 * jc)) +
      Math.sin(D2R * 2 * geomMeanAnomSun) * (0.019993 - 0.000101 * jc) +
      Math.sin(D2R * 3 * geomMeanAnomSun) * 0.000289;

    const sunTrueLong = geomMeanLongSun + sunEqOfCtr;
    const sunAppLong = sunTrueLong - 0.00569 - 0.00478 * Math.sin(D2R * (125.04 - 1934.136 * jc));

    const meanObliqEcliptic = 23 + (26 + ((21.448 - jc * (46.815 + jc * (0.00059 - jc * 0.001813)))) / 60) / 60;
    const obliqCorr = meanObliqEcliptic + 0.00256 * Math.cos(D2R * (125.04 - 1934.136 * jc));

    const sunDeclin = R2D * Math.asin(
      Math.sin(D2R * obliqCorr) * Math.sin(D2R * sunAppLong)
    );

    const varY = Math.tan(D2R * obliqCorr / 2) * Math.tan(D2R * obliqCorr / 2);

    const eqOfTime = 4 * R2D * (
      varY * Math.sin(2 * D2R * geomMeanLongSun) -
      2 * eccentEarthOrbit * Math.sin(D2R * geomMeanAnomSun) +
      4 * eccentEarthOrbit * varY * Math.sin(D2R * geomMeanAnomSun) * Math.cos(2 * D2R * geomMeanLongSun) -
      0.5 * varY * varY * Math.sin(4 * D2R * geomMeanLongSun) -
      1.25 * eccentEarthOrbit * eccentEarthOrbit * Math.sin(2 * D2R * geomMeanAnomSun)
    );

    // 90.833° accounts for the apparent radius of the sun and
    // atmospheric refraction at the horizon.
    const cosHA = (Math.cos(D2R * 90.833) / (Math.cos(D2R * lat) * Math.cos(D2R * sunDeclin))
                 - Math.tan(D2R * lat) * Math.tan(D2R * sunDeclin));
    if (cosHA < -1 || cosHA > 1) return null; // polar day/night

    const haSunrise = R2D * Math.acos(cosHA);

    // Solar noon in minutes UTC
    const solarNoon = 720 - 4 * lng - eqOfTime;
    const sunsetMinUTC = solarNoon + haSunrise * 4;

    const result = new Date(localMidnight);
    result.setUTCMinutes(result.getUTCMinutes() + Math.round(sunsetMinUTC));
    return result;
  }

  /**
   * Returns the Maghrib takbeer time as "HH:MM" in the browser's local
   * timezone — astronomical sunset for this mosque + the contributor's
   * `offsetMin` (minutes after sunset that jamaat is actually called).
   */
  function maghribForMosque(mosque, dateOverride, offsetMin = 0) {
    const lat = mosque?.coordinates?.lat ?? mosque?.latitude;
    const lng = mosque?.coordinates?.lng ?? mosque?.longitude;
    const sunset = sunsetForCoords(lat, lng, dateOverride);
    if (!sunset) return null;
    const offset = Number.isFinite(+offsetMin) ? +offsetMin : 0;
    const t = new Date(sunset.getTime() + offset * 60_000);
    const hh = String(t.getHours()).padStart(2, '0');
    const mm = String(t.getMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
  }

  // ─── Astronomical prayer times by fiqh ─────────────────────────
  // Returns {fajr, sunrise, dhuhr, asr, maghrib, isha} as "HH:MM" in the
  // browser's local timezone for the given coords + fiqh preset.
  //
  // Conventions used (angle = sun's depression below horizon at that prayer):
  //
  //   hanafi       Karachi 18°/18°, Asr factor 2 (shadow = 2 + noon shadow)
  //   shafi        MWL 18°/17°, Asr factor 1
  //   maliki       MWL 18°/17°, Asr factor 1
  //   hanbali      MWL 18°/17°, Asr factor 1
  //   jafari       Jafari 16° / Maghrib 4° / Isha 14°, Asr factor 1
  //   isna         ISNA 15°/15°, Asr factor 1
  //   egypt        Egyptian 19.5°/17.5°, Asr factor 1
  //   ummalqura    Umm al-Qura 18.5° / Isha 90 min after Maghrib, Asr factor 1
  //
  // The math: standard NOAA solar position + classic angle method. Times are
  // accurate to ~1 minute, which is well within the precision Muslims use.
  const FIQH = {
    hanafi:    { fajrAngle: 18,   ishaAngle: 18,   asrFactor: 2 },
    shafi:     { fajrAngle: 18,   ishaAngle: 17,   asrFactor: 1 },
    maliki:    { fajrAngle: 18,   ishaAngle: 17,   asrFactor: 1 },
    hanbali:   { fajrAngle: 18,   ishaAngle: 17,   asrFactor: 1 },
    jafari:    { fajrAngle: 16,   ishaAngle: 14,   asrFactor: 1, maghribAngle: 4 },
    isna:      { fajrAngle: 15,   ishaAngle: 15,   asrFactor: 1 },
    egypt:     { fajrAngle: 19.5, ishaAngle: 17.5, asrFactor: 1 },
    ummalqura: { fajrAngle: 18.5, ishaMinAfterMaghrib: 90, asrFactor: 1 },
  };

  // Internal: compute solar declination + equation of time for a given Date.
  // Returns {decl, eqOfTime, jd}. Reuses the same NOAA pipeline as sunsetForCoords.
  function solarParams(date) {
    const localMidnight = new Date(date);
    localMidnight.setUTCHours(0, 0, 0, 0);
    const jd = (localMidnight.getTime() / 86400000) + 2440587.5;
    const jc = (jd - 2451545) / 36525;

    let geomMeanLongSun = (280.46646 + jc * (36000.76983 + 0.0003032 * jc)) % 360;
    if (geomMeanLongSun < 0) geomMeanLongSun += 360;

    const geomMeanAnomSun = 357.52911 + jc * (35999.05029 - 0.0001537 * jc);
    const eccentEarthOrbit = 0.016708634 - jc * (0.000042037 + 0.0000001267 * jc);

    const sunEqOfCtr =
      Math.sin(D2R * geomMeanAnomSun) * (1.914602 - jc * (0.004817 + 0.000014 * jc)) +
      Math.sin(D2R * 2 * geomMeanAnomSun) * (0.019993 - 0.000101 * jc) +
      Math.sin(D2R * 3 * geomMeanAnomSun) * 0.000289;

    const sunTrueLong = geomMeanLongSun + sunEqOfCtr;
    const sunAppLong = sunTrueLong - 0.00569 - 0.00478 * Math.sin(D2R * (125.04 - 1934.136 * jc));

    const meanObliqEcliptic = 23 + (26 + ((21.448 - jc * (46.815 + jc * (0.00059 - jc * 0.001813)))) / 60) / 60;
    const obliqCorr = meanObliqEcliptic + 0.00256 * Math.cos(D2R * (125.04 - 1934.136 * jc));

    const decl = R2D * Math.asin(
      Math.sin(D2R * obliqCorr) * Math.sin(D2R * sunAppLong)
    );

    const varY = Math.tan(D2R * obliqCorr / 2) * Math.tan(D2R * obliqCorr / 2);
    const eqOfTime = 4 * R2D * (
      varY * Math.sin(2 * D2R * geomMeanLongSun) -
      2 * eccentEarthOrbit * Math.sin(D2R * geomMeanAnomSun) +
      4 * eccentEarthOrbit * varY * Math.sin(D2R * geomMeanAnomSun) * Math.cos(2 * D2R * geomMeanLongSun) -
      0.5 * varY * varY * Math.sin(4 * D2R * geomMeanLongSun) -
      1.25 * eccentEarthOrbit * eccentEarthOrbit * Math.sin(2 * D2R * geomMeanAnomSun)
    );

    return { decl, eqOfTime, jd, localMidnight };
  }

  // Hour-angle for a given depression angle (returns NaN at extreme latitudes
  // where the sun never reaches that depression — we guard the caller).
  function hourAngleForAngle(angle, lat, decl) {
    const cosHA = (Math.cos(D2R * (90 + angle)) - Math.sin(D2R * lat) * Math.sin(D2R * decl))
                / (Math.cos(D2R * lat) * Math.cos(D2R * decl));
    if (cosHA < -1 || cosHA > 1) return null;
    return R2D * Math.acos(cosHA);
  }

  function fmt(date) {
    if (!date) return null;
    const hh = String(date.getHours()).padStart(2, '0');
    const mm = String(date.getMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
  }

  function prayerTimesForCoords(lat, lng, fiqhKey, dateOverride) {
    if (lat == null || lng == null) return null;
    const params = FIQH[fiqhKey] || FIQH.shafi;
    const date = dateOverride || new Date();
    const { decl, eqOfTime, localMidnight } = solarParams(date);

    // Solar noon in minutes UTC (Dhuhr is solar noon).
    const solarNoonMin = 720 - 4 * lng - eqOfTime;
    const noonDate = new Date(localMidnight);
    noonDate.setUTCMinutes(noonDate.getUTCMinutes() + Math.round(solarNoonMin));

    // Sunrise / sunset (used by Maghrib + sometimes Isha fallback).
    const haSunset = hourAngleForAngle(0.833, lat, decl); // 0.833° accounts for refraction
    const sunriseDate = haSunset == null ? null : (() => {
      const d = new Date(localMidnight);
      d.setUTCMinutes(d.getUTCMinutes() + Math.round(solarNoonMin - haSunset * 4));
      return d;
    })();
    const sunsetDate = haSunset == null ? null : (() => {
      const d = new Date(localMidnight);
      d.setUTCMinutes(d.getUTCMinutes() + Math.round(solarNoonMin + haSunset * 4));
      return d;
    })();

    // Fajr: sun at fajrAngle below horizon, before sunrise.
    const haFajr = hourAngleForAngle(params.fajrAngle, lat, decl);
    const fajrDate = haFajr == null ? null : (() => {
      const d = new Date(localMidnight);
      d.setUTCMinutes(d.getUTCMinutes() + Math.round(solarNoonMin - haFajr * 4));
      return d;
    })();

    // Asr: sun's altitude when shadow = factor + noon-shadow.
    // arctan(1 / (factor + tan(|lat - decl|)))  → altitude angle
    const noonShadowTan = Math.tan(D2R * Math.abs(lat - decl));
    const asrAlt = R2D * Math.atan(1 / (params.asrFactor + noonShadowTan));
    // Convert altitude → depression below horizon (negative = below noon).
    // For Asr we want the hour-angle when the sun is at altitude `asrAlt`.
    const cosAsrHA = (Math.sin(D2R * asrAlt) - Math.sin(D2R * lat) * Math.sin(D2R * decl))
                  / (Math.cos(D2R * lat) * Math.cos(D2R * decl));
    const asrDate = (cosAsrHA < -1 || cosAsrHA > 1) ? null : (() => {
      const haAsr = R2D * Math.acos(cosAsrHA);
      const d = new Date(localMidnight);
      d.setUTCMinutes(d.getUTCMinutes() + Math.round(solarNoonMin + haAsr * 4));
      return d;
    })();

    // Maghrib: by default = sunset; Jafari uses 4° below horizon instead.
    let maghribDate;
    if (params.maghribAngle != null) {
      const haMaghrib = hourAngleForAngle(params.maghribAngle, lat, decl);
      maghribDate = haMaghrib == null ? null : (() => {
        const d = new Date(localMidnight);
        d.setUTCMinutes(d.getUTCMinutes() + Math.round(solarNoonMin + haMaghrib * 4));
        return d;
      })();
    } else {
      maghribDate = sunsetDate;
    }

    // Isha: angle method, OR Umm al-Qura's "90 min after Maghrib".
    let ishaDate;
    if (params.ishaMinAfterMaghrib && maghribDate) {
      ishaDate = new Date(maghribDate.getTime() + params.ishaMinAfterMaghrib * 60_000);
    } else {
      const haIsha = hourAngleForAngle(params.ishaAngle, lat, decl);
      ishaDate = haIsha == null ? null : (() => {
        const d = new Date(localMidnight);
        d.setUTCMinutes(d.getUTCMinutes() + Math.round(solarNoonMin + haIsha * 4));
        return d;
      })();
    }

    return {
      fajr:    fmt(fajrDate),
      sunrise: fmt(sunriseDate),
      dhuhr:   fmt(noonDate),
      asr:     fmt(asrDate),
      maghrib: fmt(maghribDate),
      isha:    fmt(ishaDate),
    };
  }

  return { sunsetForCoords, maghribForMosque, prayerTimesForCoords, FIQH };
})();

if (typeof window !== 'undefined') window.sun = sun;
if (typeof module !== 'undefined') module.exports = sun;
