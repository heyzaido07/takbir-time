// Takbeer Time website analytics.
// Runs only on the public web domain. It intentionally stays disabled on
// localhost, LAN test hosts, and native app shells so Android app traffic is
// not counted as website traffic and no analytics SDK is introduced there.
(function () {
  const MEASUREMENT_ID = 'G-CHT5XZFH8X';
  const host = window.location.hostname.toLowerCase();
  const isProductionWeb = host === 'takbeertime.com' || host === 'www.takbeertime.com';
  const isNativeShell = !!(
    window.Capacitor &&
    window.Capacitor.isNativePlatform &&
    window.Capacitor.isNativePlatform()
  );
  const isAdminPage = window.location.pathname.endsWith('/admin.html');

  if (!isProductionWeb || isNativeShell || isAdminPage) return;

  window.dataLayer = window.dataLayer || [];
  window.gtag = window.gtag || function gtag() {
    window.dataLayer.push(arguments);
  };

  const script = document.createElement('script');
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(MEASUREMENT_ID)}`;
  document.head.appendChild(script);

  window.gtag('js', new Date());
  window.gtag('config', MEASUREMENT_ID, {
    anonymize_ip: true,
    allow_google_signals: false,
    allow_ad_personalization_signals: false,
  });
})();
