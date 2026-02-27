# Floating UI Design

## Goal

Transform the current stacked vertical layout into a Google Maps-style floating UI where all controls hover above a fullscreen map.

## Layout

The map fills the entire viewport. UI elements float above it as separate positioned elements.

### Elements

1. **Map** - fullscreen base layer (`absolute inset-0`, z-0)
2. **Search panel** - top-center floating card (z-30)
   - Contains From/To inputs, departure time selector, search button
   - `rounded-xl shadow-lg bg-white`, `max-w-lg` on desktop
   - Full-width with `mx-3` margins on mobile (<640px)
3. **Route results** - drops down below search panel (z-20)
   - Same width as search panel, visually connected
   - Scrollable with `max-h-64`, `rounded-b-xl shadow-lg`
   - Only visible when results exist
4. **Filter button** - floating pill below search card, left-aligned (z-20)
   - Collapsed: shows filter icon + "Filters" label
   - Expanded: horizontally reveals Bus/Tram/Train/Ferry chip toggles
   - Animated expand/collapse with CSS transitions
5. **Alert banner** - stays at top of viewport above everything (z-40)

### Desktop Layout

```
┌──────────────────────────────────────────────┐
│       ┌──────────────────────┐               │
│       │ From: ______________ │               │
│       │ To:   ______________ │               │
│       │ Depart: [now] [Srch] │               │
│       └──────────────────────┘               │
│       ┌──────────────────────┐               │
│       │ Route 1  | 23min     │               │
│       │ Route 2  | 15min     │               │
│       └──────────────────────┘               │
│                                              │
│   [≡ Filters] [Bus][Tram][Train][Ferry]      │
│                                              │
│               FULL MAP                       │
└──────────────────────────────────────────────┘
```

### Mobile Layout

```
┌───────────────────┐
│┌─────────────────┐│
││ From / To       ││
││ [Search]        ││
│└─────────────────┘│
│┌─────────────────┐│
││ Route results   ││
│└─────────────────┘│
│                   │
│[≡ Filters][chips] │
│                   │
│     MAP           │
└───────────────────┘
```

### Z-Index Layering

| Layer | Z-Index | Element |
|-------|---------|---------|
| Base  | 0       | Map     |
| Mid   | 10      | Route results |
| Mid   | 20      | Filter button/chips |
| Top   | 30      | Search panel (needs highest for autocomplete dropdown) |
| Alert | 40      | Alert banner |

### Visual Style

- White background cards
- `rounded-xl` corners
- `shadow-lg` drop shadows
- Clean spacing with padding

## Components Changed

- `page.tsx` - layout restructured from flex-col to relative positioning
- `SearchPanel.tsx` - remove border-b, add rounded/shadow styles
- `FilterChips.tsx` - wrap in collapsible button component with expand animation
- `RouteResults.tsx` - reposition, adjust max-height, add rounded-b-xl
- `MapView.tsx` - change from flex-1 to absolute inset-0
