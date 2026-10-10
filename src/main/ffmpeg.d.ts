/** The bundled ffmpeg package has no types of its own: it exports the binary's path and version. */
declare module '@ffmpeg-installer/ffmpeg' {
  export const path: string
  export const version: string
}
