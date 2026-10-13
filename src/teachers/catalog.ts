// The teacher personas: historical people the chat can show instead of a
// robot, with the look of virtual-speaker (looks.ts) and the traits an
// agent picks them by (traits.ts). Pure data, no DiceBear, so that mcp.ts
// can import it; the images come from render.ts in the browser.

import { LOOKS, type Look } from './looks'
import { TRAITS, type Gender, type Region, type Traits } from './traits'

export type { Gender, Region, Traits }
export type Teacher = Look & Traits & { id: string; name: string }

export const GENDERS: Gender[] = ['female', 'male']
export const REGIONS: Region[] = ['europe', 'asia', 'africa', 'north-america', 'south-america', 'oceania', 'polar']

export const TEACHERS: Record<string, Teacher> = {}
for (const id of Object.keys(LOOKS) as (keyof typeof LOOKS)[]) {
  const look: Look = LOOKS[id]
  TEACHERS[id] = { ...look, ...TRAITS[id], id, name: look.name || id }
}

export type Filter = { topic?: string; gender?: string; region?: string }

// topic: part of a field or of the name, any case
export function find(filter: Filter): Teacher[] {
  const topic = (filter.topic || '').trim().toLowerCase()
  return Object.keys(TEACHERS)
    .map((id) => TEACHERS[id])
    .filter(
      (t) =>
        (!filter.gender || t.gender === filter.gender) &&
        (!filter.region || t.region === filter.region) &&
        (!topic || t.name.toLowerCase().includes(topic) || t.fields.some((f) => f.includes(topic))),
    )
}

// 1867–1934, 470–399 BC, 4 BC–65
export function years(lived: [number, number]): string {
  const [born, died] = lived
  const year = (y: number) => (y < 0 ? -y + ' BC' : String(y))
  return born < 0 && died < 0 ? -born + '–' + -died + ' BC' : year(born) + '–' + year(died)
}

export function line(t: Teacher): string {
  return [t.id, t.name, years(t.lived), t.region, t.gender, t.fields.join(', '), t.teaching].join(' · ')
}
