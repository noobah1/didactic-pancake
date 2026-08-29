// The category taxonomy behind POI search (see src/lib/places-db.ts and
// scripts/build-places-db.ts). Pure data + lookup, no I/O, so both the
// build script (mapping raw OSM tags -> a category at ingest time) and any
// runtime code (icon/label lookup by slug) share one source of truth.
//
// `terms` are folded into the FTS index at build time (see place_fts's
// category_terms column) alongside a place's own name — this is what makes
// "jõusaal" find every leisure=fitness_centre venue without a second
// mechanism, regardless of the UI's current language. Only English/
// Estonian/Russian are indexed, matching the app's three supported locales
// (see src/lib/i18n/types.ts).
export interface PlaceCategory {
  slug: string
  // A tag match list, most-specific-first — see categoryForTags. A single
  // OSM element only ever gets one category: the first list entry whose
  // key/value pair is present on the element's tags wins.
  match: { key: string; values: string[] }[]
  // A lucide-react component name (e.g. 'Dumbbell') — resolved to the actual
  // icon in the UI layer (LocationInput.tsx), never imported here so this
  // file stays framework-agnostic and testable without a DOM.
  icon: string
  // Prominence tie-break (0-100) used by rankPlaces (place-search.ts) when
  // two candidates score equal on text relevance — a supermarket should
  // usually outrank a vending machine for the same query.
  rank: number
  terms: { en: string[]; et: string[]; ru: string[] }
}

export const PLACE_CATEGORIES: PlaceCategory[] = [
  // --- Food & drink ---
  {
    slug: 'restaurant',
    match: [{ key: 'amenity', values: ['restaurant'] }],
    icon: 'UtensilsCrossed',
    rank: 70,
    terms: { en: ['restaurant', 'food'], et: ['restoran', 'söögikoht'], ru: ['ресторан', 'еда'] },
  },
  {
    slug: 'cafe',
    match: [{ key: 'amenity', values: ['cafe'] }],
    icon: 'Coffee',
    rank: 65,
    terms: { en: ['cafe', 'coffee'], et: ['kohvik', 'kohv'], ru: ['кафе', 'кофе'] },
  },
  {
    slug: 'fast_food',
    match: [{ key: 'amenity', values: ['fast_food'] }],
    icon: 'Sandwich',
    rank: 60,
    terms: { en: ['fast food', 'takeaway'], et: ['kiirtoit'], ru: ['фастфуд', 'быстрое питание'] },
  },
  {
    slug: 'bar',
    match: [{ key: 'amenity', values: ['bar'] }],
    icon: 'Martini',
    rank: 55,
    terms: { en: ['bar', 'cocktail bar'], et: ['baar'], ru: ['бар'] },
  },
  {
    slug: 'pub',
    match: [{ key: 'amenity', values: ['pub'] }],
    icon: 'Beer',
    rank: 55,
    terms: { en: ['pub'], et: ['pubi', 'õlletuba'], ru: ['паб'] },
  },
  {
    slug: 'bakery',
    match: [{ key: 'shop', values: ['bakery'] }],
    icon: 'Croissant',
    rank: 55,
    terms: { en: ['bakery'], et: ['pagariäri', 'pagar'], ru: ['пекарня', 'булочная'] },
  },

  // --- Shopping ---
  {
    slug: 'supermarket',
    match: [{ key: 'shop', values: ['supermarket'] }],
    icon: 'ShoppingCart',
    rank: 85,
    terms: { en: ['supermarket', 'grocery'], et: ['pood', 'toidupood', 'supermarket'], ru: ['супермаркет', 'магазин'] },
  },
  {
    slug: 'convenience',
    match: [{ key: 'shop', values: ['convenience'] }],
    icon: 'Store',
    rank: 60,
    terms: { en: ['convenience store', 'corner shop'], et: ['minipood'], ru: ['магазин у дома'] },
  },
  {
    slug: 'mall',
    match: [{ key: 'shop', values: ['mall'] }],
    icon: 'ShoppingBag',
    rank: 90,
    terms: { en: ['mall', 'shopping centre'], et: ['kaubanduskeskus', 'kaubamaja'], ru: ['торговый центр'] },
  },
  {
    slug: 'clothes',
    match: [{ key: 'shop', values: ['clothes'] }],
    icon: 'ShoppingBag',
    rank: 55,
    terms: { en: ['clothes', 'clothing'], et: ['rõivapood', 'riided'], ru: ['одежда'] },
  },
  {
    slug: 'electronics',
    match: [{ key: 'shop', values: ['electronics'] }],
    icon: 'Cpu',
    rank: 55,
    terms: { en: ['electronics'], et: ['elektroonika'], ru: ['электроника'] },
  },
  {
    slug: 'hardware',
    match: [{ key: 'shop', values: ['hardware', 'doityourself'] }],
    icon: 'Hammer',
    rank: 50,
    terms: { en: ['hardware store', 'diy'], et: ['ehituspood'], ru: ['хозтовары', 'строительный магазин'] },
  },
  {
    slug: 'books',
    match: [{ key: 'shop', values: ['books'] }],
    icon: 'BookOpen',
    rank: 45,
    terms: { en: ['books', 'bookshop'], et: ['raamatupood'], ru: ['книжный магазин'] },
  },
  {
    slug: 'alcohol',
    match: [{ key: 'shop', values: ['alcohol'] }],
    icon: 'Wine',
    rank: 50,
    terms: { en: ['alcohol', 'liquor store'], et: ['alkoholipood'], ru: ['алкоголь', 'винный магазин'] },
  },
  {
    slug: 'hairdresser',
    match: [{ key: 'shop', values: ['hairdresser'] }],
    icon: 'Scissors',
    rank: 45,
    terms: { en: ['hairdresser', 'barber'], et: ['juuksur'], ru: ['парикмахерская'] },
  },
  {
    slug: 'beauty',
    match: [{ key: 'shop', values: ['beauty'] }],
    icon: 'Sparkles',
    rank: 40,
    terms: { en: ['beauty salon'], et: ['iluteenindus', 'ilusalong'], ru: ['салон красоты'] },
  },
  {
    slug: 'optician',
    match: [{ key: 'shop', values: ['optician'] }],
    icon: 'Glasses',
    rank: 40,
    terms: { en: ['optician'], et: ['optika'], ru: ['оптика'] },
  },

  // --- Fitness ---
  {
    slug: 'gym',
    match: [{ key: 'leisure', values: ['fitness_centre'] }],
    icon: 'Dumbbell',
    rank: 65,
    terms: { en: ['gym', 'fitness', 'fitness centre'], et: ['jõusaal', 'sportsklubi', 'fitness'], ru: ['спортзал', 'фитнес', 'тренажерный зал'] },
  },
  {
    slug: 'swimming_pool',
    match: [{ key: 'leisure', values: ['swimming_pool'] }],
    icon: 'Waves',
    rank: 55,
    terms: { en: ['swimming pool', 'pool'], et: ['ujula', 'bassein'], ru: ['бассейн'] },
  },
  {
    slug: 'sports_centre',
    match: [{ key: 'leisure', values: ['sports_centre'] }],
    icon: 'Trophy',
    rank: 60,
    terms: { en: ['sports centre', 'sports hall'], et: ['spordikeskus', 'spordihall'], ru: ['спортивный центр'] },
  },

  // --- Health ---
  {
    slug: 'pharmacy',
    match: [{ key: 'amenity', values: ['pharmacy'] }],
    icon: 'Pill',
    rank: 75,
    terms: { en: ['pharmacy', 'chemist'], et: ['apteek'], ru: ['аптека'] },
  },
  {
    slug: 'hospital',
    match: [{ key: 'amenity', values: ['hospital'] }],
    icon: 'Cross',
    rank: 80,
    terms: { en: ['hospital'], et: ['haigla'], ru: ['больница'] },
  },
  {
    slug: 'clinic',
    match: [{ key: 'amenity', values: ['clinic'] }],
    icon: 'HeartPulse',
    rank: 60,
    terms: { en: ['clinic', 'medical centre'], et: ['kliinik', 'tervisekeskus'], ru: ['клиника'] },
  },
  {
    slug: 'doctor',
    match: [{ key: 'amenity', values: ['doctors'] }],
    icon: 'Stethoscope',
    rank: 55,
    terms: { en: ['doctor', 'gp'], et: ['perearst', 'arst'], ru: ['врач'] },
  },
  {
    slug: 'dentist',
    match: [{ key: 'amenity', values: ['dentist'] }],
    icon: 'Smile',
    rank: 55,
    terms: { en: ['dentist'], et: ['hambaarst'], ru: ['стоматолог'] },
  },
  {
    slug: 'veterinary',
    match: [{ key: 'amenity', values: ['veterinary'] }],
    icon: 'PawPrint',
    rank: 45,
    terms: { en: ['vet', 'veterinary'], et: ['loomaarst', 'veterinaar'], ru: ['ветеринар'] },
  },

  // --- Money & post ---
  {
    slug: 'bank',
    match: [{ key: 'amenity', values: ['bank'] }],
    icon: 'Landmark',
    rank: 55,
    terms: { en: ['bank'], et: ['pank'], ru: ['банк'] },
  },
  {
    slug: 'atm',
    match: [{ key: 'amenity', values: ['atm'] }],
    icon: 'CreditCard',
    rank: 35,
    terms: { en: ['atm', 'cash machine'], et: ['sularahaautomaat'], ru: ['банкомат'] },
  },
  {
    slug: 'post_office',
    match: [{ key: 'amenity', values: ['post_office'] }],
    icon: 'Mail',
    rank: 45,
    terms: { en: ['post office'], et: ['postkontor'], ru: ['почта'] },
  },

  // --- Culture & nightlife ---
  {
    slug: 'cinema',
    match: [{ key: 'amenity', values: ['cinema'] }],
    icon: 'Clapperboard',
    rank: 60,
    terms: { en: ['cinema', 'movie theatre'], et: ['kino'], ru: ['кинотеатр'] },
  },
  {
    slug: 'theatre',
    match: [{ key: 'amenity', values: ['theatre'] }],
    icon: 'Drama',
    rank: 55,
    terms: { en: ['theatre'], et: ['teater'], ru: ['театр'] },
  },
  {
    slug: 'museum',
    match: [{ key: 'tourism', values: ['museum'] }],
    icon: 'Building2',
    rank: 55,
    terms: { en: ['museum'], et: ['muuseum'], ru: ['музей'] },
  },
  {
    slug: 'library',
    match: [{ key: 'amenity', values: ['library'] }],
    icon: 'Library',
    rank: 45,
    terms: { en: ['library'], et: ['raamatukogu'], ru: ['библиотека'] },
  },
  {
    slug: 'nightclub',
    match: [{ key: 'amenity', values: ['nightclub'] }],
    icon: 'Disc3',
    rank: 50,
    terms: { en: ['nightclub', 'club'], et: ['ööklubi'], ru: ['ночной клуб'] },
  },
  {
    slug: 'park',
    match: [{ key: 'leisure', values: ['park'] }],
    icon: 'Trees',
    rank: 50,
    terms: { en: ['park'], et: ['park'], ru: ['парк'] },
  },

  // --- Travel & transport ---
  {
    slug: 'hotel',
    match: [{ key: 'tourism', values: ['hotel'] }],
    icon: 'BedDouble',
    rank: 65,
    terms: { en: ['hotel'], et: ['hotell'], ru: ['отель', 'гостиница'] },
  },
  {
    slug: 'hostel',
    match: [{ key: 'tourism', values: ['hostel'] }],
    icon: 'Bed',
    rank: 50,
    terms: { en: ['hostel'], et: ['hostel'], ru: ['хостел'] },
  },
  {
    slug: 'guest_house',
    match: [{ key: 'tourism', values: ['guest_house', 'bed_and_breakfast'] }],
    icon: 'House',
    rank: 55,
    terms: { en: ['guesthouse', 'bed and breakfast', 'b&b'], et: ['külalistemaja', 'kodumajutus'], ru: ['гостевой дом', 'гостевой дом с завтраком'] },
  },
  {
    slug: 'apartment',
    match: [{ key: 'tourism', values: ['apartment'] }],
    icon: 'Building',
    rank: 45,
    terms: { en: ['apartment', 'serviced apartment'], et: ['korterhotell', 'apartement'], ru: ['апартаменты'] },
  },
  {
    slug: 'motel',
    match: [{ key: 'tourism', values: ['motel'] }],
    icon: 'BedSingle',
    rank: 50,
    terms: { en: ['motel'], et: ['motell'], ru: ['мотель'] },
  },
  {
    slug: 'fuel',
    match: [{ key: 'amenity', values: ['fuel'] }],
    icon: 'Fuel',
    rank: 55,
    terms: { en: ['petrol station', 'gas station', 'fuel'], et: ['tankla', 'bensiinijaam'], ru: ['заправка', 'азс'] },
  },
  {
    slug: 'charging_station',
    match: [{ key: 'amenity', values: ['charging_station'] }],
    icon: 'BatteryCharging',
    rank: 40,
    terms: { en: ['charging station', 'ev charger'], et: ['laadimisjaam'], ru: ['зарядная станция'] },
  },
  {
    slug: 'parking',
    match: [{ key: 'amenity', values: ['parking'] }],
    icon: 'SquareParking',
    rank: 35,
    terms: { en: ['parking'], et: ['parkla'], ru: ['парковка', 'стоянка'] },
  },

  // --- Civic ---
  {
    slug: 'police',
    match: [{ key: 'amenity', values: ['police'] }],
    icon: 'Shield',
    rank: 45,
    terms: { en: ['police station', 'police'], et: ['politsei', 'politseijaoskond'], ru: ['полиция'] },
  },
  {
    slug: 'school',
    match: [{ key: 'amenity', values: ['school'] }],
    icon: 'School',
    rank: 45,
    terms: { en: ['school'], et: ['kool'], ru: ['школа'] },
  },
  {
    slug: 'university',
    match: [{ key: 'amenity', values: ['university'] }],
    icon: 'GraduationCap',
    rank: 55,
    terms: { en: ['university'], et: ['ülikool'], ru: ['университет'] },
  },
  {
    slug: 'kindergarten',
    match: [{ key: 'amenity', values: ['kindergarten'] }],
    icon: 'Baby',
    rank: 40,
    terms: { en: ['kindergarten', 'nursery'], et: ['lasteaed'], ru: ['детский сад'] },
  },
]

// The accommodation subset — the only categories the Departures tab's place
// search is allowed to return (see /api/geocode's isStopSearch branch). A
// general POI browse (restaurants, shops, ...) doesn't belong in a
// departure-board finder, but "what stop is near my hotel" does.
export const ACCOMMODATION_CATEGORIES = ['hotel', 'hostel', 'guest_house', 'apartment', 'motel']

const CATEGORY_BY_SLUG = new Map(PLACE_CATEGORIES.map((c) => [c.slug, c]))

export function placeCategoryBySlug(slug: string): PlaceCategory | undefined {
  return CATEGORY_BY_SLUG.get(slug)
}

// A rider-facing category label ("Supermarket", "Jõusaal", "Спортзал") for
// the dropdown row/badge — reuses each category's own first search term per
// language rather than a separate label field, since that term is already
// written as the category's plain, canonical name (see the `terms` field
// comment above) and keeping one list instead of two means a category can't
// drift out of sync with its own display name. Falls back to English, same
// as src/lib/i18n/context.tsx's own t() does for a missing translation.
export function categoryLabel(category: PlaceCategory, lang: 'en' | 'et' | 'ru'): string {
  const term = category.terms[lang][0] || category.terms.en[0]
  return term.charAt(0).toUpperCase() + term.slice(1)
}

// Maps a raw OSM element's tags to a category, most-specific-first: the
// PLACE_CATEGORIES array order is the tie-break when an element carries
// more than one taggable kind (e.g. a supermarket that also has
// leisure=park benches out front) — the first list entry whose key/value
// is present wins, rather than every matching category being considered
// equally. Returns null when nothing in the taxonomy recognizes the tags
// at all — the caller (scripts/build-places-db.ts) drops that element
// rather than indexing an uncategorized place with no icon or label.
export function categoryForTags(tags: Record<string, string>): PlaceCategory | null {
  for (const category of PLACE_CATEGORIES) {
    for (const { key, values } of category.match) {
      const value = tags[key]
      if (value && values.includes(value)) return category
    }
  }
  return null
}
