// Kuvan pienennys: sama JPEG tallennetaan laitteelle ja lähetetään tulkittavaksi. Raakaa tiedostoa ei koskaan lähetetä.
//
// aiops-välittäjä hyväksyy enintään 1 MiB:n pyynnön, ja base64 kasvattaa kuvaa kolmanneksella, joten lähtevä kuva saa
// olla enintään 700 kt (palvelimen kuva.KUVA_MAX on sama luku). Pidempi sivu 1600 px ja laatu 0,8; jos kuva on yhä liian
// suuri, laatua lasketaan ja lopuksi sivua pienennetään. Uudelleenkoodaus pudottaa EXIF-tiedot, myös sijainnin.
export const MAX_INPUT_BYTES = 15 * 1024 * 1024;
export const LAHETYS_MAX = 700_000;
export const ASKELEET = [
  { sivu: 1600, laatu: 0.8 },
  { sivu: 1600, laatu: 0.7 },
  { sivu: 1600, laatu: 0.6 },
  { sivu: 1280, laatu: 0.6 },
] as const;

export type Koodaa = (sivu: number, laatu: number) => Promise<Blob>;

/** Kokeilee askeleet järjestyksessä ja palauttaa ensimmäisen tuloksen, joka mahtuu rajaan. */
export async function pienennaRajaan(
  koodaa: Koodaa,
  raja = LAHETYS_MAX,
): Promise<Blob> {
  for (const { sivu, laatu } of ASKELEET) {
    const blob = await koodaa(sivu, laatu);
    if (blob.size <= raja) return blob;
  }
  throw new Error("Kuvaa ei saatu tarpeeksi pieneksi. Valitse toinen kuva.");
}

export async function compressPhoto(file: Blob): Promise<Blob> {
  if (file.size > MAX_INPUT_BYTES)
    throw new Error("Kuva on liian suuri. Enimmäiskoko on 15 Mt.");
  let bitmap: ImageBitmap;
  try {
    // Selain avaa kaikki muodot, jotka se tuntee (myös HEIC Safarissa); tyyppiä ei tarkisteta etukäteen.
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error("Kuvaa ei voitu avata. Valitse JPG-, PNG- tai WebP-kuva.");
  }
  try {
    if (bitmap.width * bitmap.height > 80_000_000)
      throw new Error("Kuvan tarkkuus on liian suuri.");
    return await pienennaRajaan((sivu, laatu) => koodaa(bitmap, sivu, laatu));
  } finally {
    bitmap.close();
  }
}

function koodaa(bitmap: ImageBitmap, sivu: number, laatu: number) {
  const ratio = Math.min(1, sivu / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * ratio);
  canvas.height = Math.round(bitmap.height * ratio);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Kuvan käsittely ei onnistu tässä selaimessa.");
  // Läpinäkyvä PNG saa valkoisen taustan: JPEG ei tunne läpinäkyvyyttä. Väri ei ole käyttöliittymän väri.
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (b) =>
        b ? resolve(b) : reject(new Error("Kuvan pienentäminen epäonnistui.")),
      "image/jpeg",
      laatu,
    ),
  );
}
