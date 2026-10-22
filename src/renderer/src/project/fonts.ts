import type { ProjectFont } from '../../../shared/api'
import { forgetTextLayouts } from '../model/text'
import { useStore } from '../state/store'

/**
 * Fonts of the project (D267, D44): every font file in `assets/fonts` is loaded when the project
 * opens, under its file name, so `font: 'Inter'` finds `assets/fonts/Inter.ttf` as it would an
 * installed family; a font from the web is such a file put there. The installed families are
 * read once, for the Selected pane's list, where the browser allows.
 */

/** Goes up whenever the fonts change, so what was measured and drawn with the old ones is done again. */
export const fontsVersion = { current: 0 }

let loaded: FontFace[] = []
let projectFonts: ProjectFont[] = []

/** The bytes of one of the project's fonts, by family, for the outlines of a text (D273); null for a family not in the project. */
export function projectFontData(family: string): Uint8Array | null {
  const key = family.trim().toLowerCase()
  return projectFonts.find((f) => f.name.toLowerCase() === key)?.data ?? null
}

/** Load a project's fonts, letting the last project's go; done once every face is in, or has failed with a note in the console. */
export async function loadProjectFonts(fonts: ProjectFont[]): Promise<void> {
  for (const face of loaded) document.fonts.delete(face)
  loaded = []
  projectFonts = fonts
  const names: string[] = []
  await Promise.all(
    fonts.map(async (font) => {
      try {
        const data = font.data instanceof Uint8Array ? font.data : new Uint8Array(font.data as ArrayBufferLike)
        const face = new FontFace(font.name, data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer)
        await face.load()
        document.fonts.add(face)
        loaded.push(face)
        names.push(font.name)
      } catch (err) {
        console.warn(`Font ${font.file} could not be loaded`, err)
      }
    }),
  )
  fontsVersion.current++
  forgetTextLayouts()
  useStore.getState().setFonts(names.sort(), fontsVersion.current)
}

let systemFontsAsked = false

/** The installed font families, read once where the browser allows it, into the store. */
export function askSystemFonts(): void {
  if (systemFontsAsked) return
  systemFontsAsked = true
  const query = (window as unknown as { queryLocalFonts?: () => Promise<{ family: string }[]> }).queryLocalFonts
  if (!query) return
  void query
    .call(window)
    .then((faces) => {
      const families = [...new Set(faces.map((f) => f.family))].sort((a, b) => a.localeCompare(b))
      useStore.getState().setSystemFonts(families)
    })
    .catch(() => {
      // Not allowed here: the field still takes any family name.
    })
}
