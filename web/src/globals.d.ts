// Compile-time flag injected by vite (see vite.config.ts). True in the full
// build, false in the core build (where the pdf.js chunk is dropped).
declare const __PDF_PREVIEW__: boolean;

// Vite asset imports (e.g. `pdf.worker.min.mjs?url`).
declare module "*?url" {
  const src: string;
  export default src;
}
