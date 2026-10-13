// The images of a teacher persona, a reduced copy of src/avatar.ts and
// src/faces.ts of LiaTemplates/virtual-speaker: the resting face and the
// faces with an open mouth, as data URIs, for the styles looks.ts uses.
// Only in the browser bundle: DiceBear is ESM only.

import { createAvatar } from '@dicebear/core'
import * as avataaars from '@dicebear/avataaars'
import * as lorelei from '@dicebear/lorelei'
import * as micah from '@dicebear/micah'
import * as notionists from '@dicebear/notionists'
import * as personas from '@dicebear/personas'
import * as toonHead from '@dicebear/toon-head'
import type { Teacher } from './catalog'

const STYLES: Record<string, any> = {
  avataaars,
  lorelei,
  micah,
  notionists,
  personas,
  'toon-head': toonHead,
}

// key: the component of the mouth; open: shown while speaking; closed: the
// resting mouth, unless the look sets one. eyes: the resting eyes, unless
// the look sets them (selected visually in virtual-speaker)
type Face = { mouth: { key: string; open: string[]; closed?: string[] }; eyes?: string[] }

const FACES: Record<string, Face> = {
  avataaars: {
    mouth: { key: 'mouth', open: ['default', 'disbelief'], closed: ['twinkle', 'smile', 'serious'] },
    eyes: ['default', 'squint', 'surprised'],
  },
  lorelei: {
    mouth: { key: 'mouth', open: ['happy07', 'happy08', 'sad01'] },
    eyes: ['variant24', 'variant23', 'variant21', 'variant20', 'variant16', 'variant14', 'variant13', 'variant10', 'variant06', 'variant04', 'variant02'],
  },
  micah: {
    mouth: { key: 'mouth', open: ['surprised', 'laughing'], closed: ['smile', 'smirk', 'pucker'] },
    eyes: ['eyes', 'round', 'eyesShadow'],
  },
  notionists: { mouth: { key: 'lips', open: ['variant29', 'variant25', 'variant14', 'variant11'] } },
  personas: {
    mouth: { key: 'mouth', open: ['surprise', 'bigSmile'], closed: ['smile', 'smirk', 'lips'] },
    eyes: ['open'],
  },
  'toon-head': {
    mouth: { key: 'mouth', open: ['agape', 'laugh'], closed: ['smile', 'sad'] },
    eyes: ['happy', 'wide'],
  },
}

export type Frames = { rest: string; mouths: string[]; background: string | null; title: string }

export function frames(t: Teacher): Frames {
  const style = STYLES[t.style]
  const { mouth, eyes } = FACES[t.style]
  const options: Record<string, unknown> = { ...t.options, seed: t.seed }
  if (mouth.closed && options[mouth.key] === undefined) options[mouth.key] = mouth.closed
  if (eyes && options.eyes === undefined) options.eyes = eyes

  const resting = createAvatar(style, options).toJson().extra as Record<string, any>
  const background = toCSS(resting)
  // the background stays behind the images, also while the mouth moves
  options.backgroundColor = ['transparent']

  const face = (value: string) =>
    createAvatar(style, { ...options, [mouth.key]: [value], [mouth.key + 'Probability']: 100 }).toDataUri()

  return {
    rest: face(resting[mouth.key]),
    mouths: mouth.open.filter((v) => v !== resting[mouth.key]).map(face),
    background,
    title: title(t, style.meta || {}),
  }
}

// a linear gradient of DiceBear runs from left to right, rotated clockwise
function toCSS(extra: Record<string, any>): string | null {
  const primary = extra.primaryBackgroundColor
  if (!primary || primary === 'transparent') return null
  if (extra.backgroundType === 'gradientLinear') {
    return 'linear-gradient(' + (90 + (Number(extra.backgroundRotation) || 0)) + 'deg, ' + primary + ', ' + extra.secondaryBackgroundColor + ')'
  }
  return primary
}

// the licenses of toon-head, micah and personas ask for the credit
function title(t: Teacher, meta: any): string {
  const credit = [
    meta.title && '"' + meta.title + '"',
    meta.creator && 'by ' + meta.creator,
    meta.license && meta.license.name && 'licensed under ' + meta.license.name,
  ]
    .filter(Boolean)
    .join(' ')
  return t.name + ' – Avatar: ' + credit + ' (via DiceBear)'
}
