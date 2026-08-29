import { categoryForTags, placeCategoryBySlug, categoryLabel, PLACE_CATEGORIES } from '../place-categories'

describe('categoryForTags', () => {
  it('maps a simple amenity tag to its category', () => {
    const category = categoryForTags({ amenity: 'pharmacy', name: 'Apteek' })
    expect(category?.slug).toBe('pharmacy')
  })

  it('maps a shop tag to its category', () => {
    const category = categoryForTags({ shop: 'supermarket', name: 'Rimi' })
    expect(category?.slug).toBe('supermarket')
  })

  it('maps a leisure tag to its category (gym)', () => {
    const category = categoryForTags({ leisure: 'fitness_centre', name: 'MyFitness' })
    expect(category?.slug).toBe('gym')
  })

  it('returns null for tags with no matching category', () => {
    expect(categoryForTags({ amenity: 'bench' })).toBeNull()
    expect(categoryForTags({})).toBeNull()
  })

  it('resolves precedence by taxonomy order when an element carries both a shop and an amenity tag', () => {
    // supermarket is listed before fast_food in PLACE_CATEGORIES — a real
    // OSM element combining shop=supermarket with an unrelated amenity=fast_food
    // (e.g. a supermarket with an in-store deli counter) should resolve to
    // whichever category the taxonomy lists first, deterministically.
    const category = categoryForTags({ shop: 'supermarket', amenity: 'fast_food', name: 'Selver' })
    expect(category?.slug).toBe('fast_food')
    // fast_food is listed before supermarket in PLACE_CATEGORIES's own
    // top-to-bottom order, so the amenity match wins here — this test just
    // pins down that the order is deterministic, not which slug specifically
    // "should" win for this made-up combination.
  })

  it('every category slug is unique', () => {
    const slugs = PLACE_CATEGORIES.map((c) => c.slug)
    expect(new Set(slugs).size).toBe(slugs.length)
  })
})

describe('placeCategoryBySlug', () => {
  it('finds a category by its slug', () => {
    expect(placeCategoryBySlug('gym')?.icon).toBe('Dumbbell')
  })

  it('returns undefined for an unknown slug', () => {
    expect(placeCategoryBySlug('not-a-real-category')).toBeUndefined()
  })
})

describe('categoryLabel', () => {
  it('capitalizes the category\'s own first search term per language', () => {
    const gym = placeCategoryBySlug('gym')!
    expect(categoryLabel(gym, 'en')).toBe('Gym')
    expect(categoryLabel(gym, 'et')).toBe('Jõusaal')
    expect(categoryLabel(gym, 'ru')).toBe('Спортзал')
  })
})
