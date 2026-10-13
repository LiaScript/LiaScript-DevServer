// window.Teachers for the chat (views/avatar.js, views/chat.js): the
// catalog without the DiceBear options, and the images of a person.

import { TEACHERS, years } from './catalog'
import { frames, type Frames } from './render'

const cache: Record<string, Frames> = {}

// own ids only: an answer such as toString or constructor is nobody
const known = (id: string) => Object.prototype.hasOwnProperty.call(TEACHERS, id)

;(window as any).Teachers = {
  ids: () => Object.keys(TEACHERS),
  get(id: string) {
    if (!known(id)) return undefined
    const t = TEACHERS[id]
    const { style, seed, options, ...rest } = t
    return { ...rest, years: years(t.lived) }
  },
  frames(id: string) {
    if (!known(id)) return undefined
    return Object.prototype.hasOwnProperty.call(cache, id) ? cache[id] : (cache[id] = frames(TEACHERS[id]))
  },
}
