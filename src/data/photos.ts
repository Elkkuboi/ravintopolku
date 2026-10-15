export const MAX_INPUT_BYTES = 15 * 1024 * 1024;
export const MAX_STORED_BYTES = 2 * 1024 * 1024;
export async function compressPhoto(file: File): Promise<Blob> {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type))
    throw new Error("Valitse JPG-, PNG- tai WebP-kuva.");
  if (file.size > MAX_INPUT_BYTES)
    throw new Error("Kuva on liian suuri. Enimmäiskoko on 15 Mt.");
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error(
      "Kuvaa ei voitu avata. Voit jatkaa kirjaamista ilman kuvaa.",
    );
  }
  try {
    if (bitmap.width * bitmap.height > 80_000_000)
      throw new Error("Kuvan tarkkuus on liian suuri.");
    const ratio = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * ratio);
    canvas.height = Math.round(bitmap.height * ratio);
    const ctx = canvas.getContext("2d");
    if (!ctx)
      throw new Error("Kuvan käsittely ei onnistu. Voit kirjata ilman kuvaa.");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (b) =>
          b
            ? resolve(b)
            : reject(new Error("Kuvan pienentäminen epäonnistui.")),
        "image/jpeg",
        0.85,
      ),
    );
    if (blob.size > MAX_STORED_BYTES)
      throw new Error(
        "Pienennetty kuva ylittää 2 Mt:n rajan. Valitse pienempi kuva.",
      );
    return blob;
  } finally {
    bitmap.close();
  }
}
