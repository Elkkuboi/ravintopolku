// Ravintopolku: viimeksi tunnettu Ilmari Hubin väri ennen ensimmäistä piirtoa. Erillinen tiedosto, koska CSP kieltää
// inline-skriptit. src/vari.ts tallentaa arvot ja päivittää ne palvelimelta; tuntematon arvo jätetään huomiotta.
(function () {
  try {
    var vari = window.localStorage.getItem("ravintopolku-vari");
    if (["paperi", "liitu", "terminaali", "fosfori"].indexOf(vari) < 0) return;
    document.documentElement.setAttribute("data-vari", vari);
    var skeema = document.querySelector('meta[name="color-scheme"]');
    if (skeema)
      skeema.setAttribute(
        "content",
        vari === "terminaali" || vari === "fosfori" ? "dark" : "light",
      );
    var tausta = window.localStorage.getItem("ravintopolku-tausta");
    var tila = document.querySelector('meta[name="theme-color"]');
    if (tila && tausta && /^#[0-9a-f]{6}$/i.test(tausta))
      tila.setAttribute("content", tausta);
  } catch {
    // Tallennus estetty: tyyli käyttää oletusväriä (paperi).
  }
})();
