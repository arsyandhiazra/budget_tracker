// Menentukan tema (terang/gelap) SEBELUM halaman digambar, supaya tidak berkedip terang dulu.
// Berupa file terpisah karena aplikasi melarang skrip yang ditulis langsung di halaman (CSP).
(function () {
  try {
    var pref = localStorage.getItem("bt_theme"); // "light" | "dark" | "system" (kosong = ikut perangkat)
    var dark = pref === "dark" || (pref !== "light" && window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", dark ? "#151514" : "#f4f3ee");
  } catch (e) {
    /* penyimpanan browser dimatikan: pakai tema terang */
  }
})();
