// window.Teachers for the chat (views/avatar.js, views/chat.js): the
// catalog without the DiceBear options, and the images of a person.

import { TEACHERS, years } from './catalog'
import { frames, type Frames } from './render'

const cache: Record<string, Frames> = {}

;(window as any).Teachers = {
  ids: () => Object.keys(TEACHERS),
  get(id: string) {
    const t = TEACHERS[id]
    if (!t) return undefined
    const { style, seed, options, ...rest } = t
    return { ...rest, years: years(t.lived) }
  },
  frames(id: string) {
    const t = TEACHERS[id]
    if (!t) return undefined
    return cache[id] || (cache[id] = frames(t))
  },
}
