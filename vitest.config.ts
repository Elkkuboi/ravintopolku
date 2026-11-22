import { defineConfig } from "vitest/config";

// Vitest luo DOM-ympäristön; appin tyyppien mukaan ImageBitmap on saatavilla.
declare const createImageBitmap: (
  source: Blob | ImageData,
  options?: ImageBitmapOptions,
) => Promise<ImageBitmap>;
declare const ImageBitmap: {
  readonly width: number;
  readonly height: number;
  close(): void;
};

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    setupFiles: ["tests/setup.ts"],
  },
});
