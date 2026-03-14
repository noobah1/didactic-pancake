# Floating UI Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Transform the stacked vertical layout into a Google Maps-style floating UI where search, filters, and results hover above a fullscreen map.

**Architecture:** The map becomes the fullscreen base layer filling the viewport. A single wrapper div positioned absolutely over the map contains the search panel and route results (stacked vertically, centered top). A separate collapsible filter button floats independently below them. All use z-index layering to stay above the map.

**Tech Stack:** Next.js, React, Tailwind CSS v4, MapLibre GL

**Design doc:** `docs/plans/2026-02-27-floating-ui-design.md`

---

### Task 1: Make MapView fullscreen

**Files:**
- Modify: `src/components/MapView.tsx:505` (the return statement)

**Step 1: Change MapView container class**

In `src/components/MapView.tsx`, change line 505 from:
```tsx
return <div ref={containerRef} className="flex-1" />
```
to:
```tsx
return <div ref={containerRef} className="absolute inset-0" />
```

**Step 2: Verify the app still renders**

Run: `npm run dev`
Open browser, confirm the map renders (it will look broken since the parent layout hasn't changed yet — that's expected).

**Step 3: Commit**

```bash
git add src/components/MapView.tsx
git commit -m "refactor: make MapView use absolute positioning for fullscreen"
```

---

### Task 2: Restructure page layout to relative container

**Files:**
- Modify: `src/app/page.tsx`

**Step 1: Update page.tsx layout**

Replace the entire `return` statement of `HomeContent` (lines 55-87) with:

```tsx
return (
  <main className="h-dvh relative overflow-hidden">
    {/* Fullscreen map base layer */}
    <ErrorBoundary
      fallback={
        <div className="absolute inset-0 flex items-center justify-center text-gray-500">
          Map unavailable
        </div>
      }
    >
      <MapView
        vehicles={vehicleData.data?.vehicles}
        activeModes={activeModes}
        selectedRoute={selectedRoute}
      />
    </ErrorBoundary>

    {/* Alert banner - top of viewport */}
    {alertData.data?.alerts && alertData.data.alerts.length > 0 && (
      <div className="absolute top-0 left-0 right-0 z-40">
        <AlertBanner alerts={alertData.data.alerts} />
      </div>
    )}

    {/* Floating search + results panel - top center */}
    <div className="absolute top-3 left-1/2 -translate-x-1/2 z-30 w-full max-w-lg px-3 sm:px-0">
      <SearchPanel onSearch={handleSearch} modes={activeModes} />
      <ErrorBoundary
        fallback={<div className="p-4 text-center text-gray-500">Route search unavailable</div>}
      >
        <RouteResults
          routes={routes}
          loading={loading}
          error={error}
          selectedId={selectedRouteId}
          onSelect={setSelectedRouteId}
        />
      </ErrorBoundary>
    </div>

    {/* Floating filter chips - below search panel, left-aligned */}
    <div className="absolute top-auto left-3 z-20" style={{ top: 'calc(var(--search-panel-bottom, 200px) + 12px)' }}>
      <FilterChips activeModes={activeModes} onToggle={handleToggle} />
    </div>
  </main>
)
```

Note: The filter chips positioning with CSS variable won't work yet — we'll fix it in Task 4 with a ref-based approach. For now, position it with a reasonable fixed offset.

Actually, let's simplify: position the filter chips with a simpler approach. We'll put them inside the same centered column but as a separate floating element:

```tsx
return (
  <main className="h-dvh relative overflow-hidden">
    {/* Fullscreen map base layer */}
    <ErrorBoundary
      fallback={
        <div className="absolute inset-0 flex items-center justify-center text-gray-500">
          Map unavailable
        </div>
      }
    >
      <MapView
        vehicles={vehicleData.data?.vehicles}
        activeModes={activeModes}
        selectedRoute={selectedRoute}
      />
    </ErrorBoundary>

    {/* Alert banner - top of viewport */}
    {alertData.data?.alerts && alertData.data.alerts.length > 0 && (
      <div className="absolute top-0 left-0 right-0 z-40">
        <AlertBanner alerts={alertData.data.alerts} />
      </div>
    )}

    {/* Floating UI column - top center, contains search + results + filters */}
    <div className="absolute top-3 left-1/2 -translate-x-1/2 z-30 w-full max-w-lg px-3 sm:px-0 pointer-events-none">
      <div className="pointer-events-auto">
        <SearchPanel onSearch={handleSearch} modes={activeModes} />
      </div>
      <div className="pointer-events-auto">
        <ErrorBoundary
          fallback={<div className="p-4 text-center text-gray-500">Route search unavailable</div>}
        >
          <RouteResults
            routes={routes}
            loading={loading}
            error={error}
            selectedId={selectedRouteId}
            onSelect={setSelectedRouteId}
          />
        </ErrorBoundary>
      </div>
      <div className="pointer-events-auto mt-2 flex justify-start">
        <FilterChips activeModes={activeModes} onToggle={handleToggle} />
      </div>
    </div>
  </main>
)
```

Key changes:
- `main` changes from `h-dvh flex flex-col` to `h-dvh relative overflow-hidden`
- Map rendered first as the base layer (already has `absolute inset-0`)
- Alert banner wrapped in `absolute top-0 left-0 right-0 z-40`
- Search panel + results + filters in a centered floating column with `pointer-events-none` on the wrapper (so map clicks pass through empty areas) and `pointer-events-auto` on each interactive element
- `max-w-lg` constrains width on desktop, `px-3` adds margin on mobile

**Step 2: Verify layout**

Run: `npm run dev`
Confirm: map is fullscreen, search panel floats top-center, filter chips appear below.

**Step 3: Commit**

```bash
git add src/app/page.tsx
git commit -m "refactor: restructure layout to floating UI over fullscreen map"
```

---

### Task 3: Style SearchPanel as a floating card

**Files:**
- Modify: `src/components/SearchPanel.tsx:28`

**Step 1: Update SearchPanel container class**

In `src/components/SearchPanel.tsx`, change line 28 from:
```tsx
<div className="flex flex-col gap-3 p-4 bg-white border-b border-gray-200">
```
to:
```tsx
<div className="flex flex-col gap-3 p-4 bg-white rounded-xl shadow-lg">
```

Changes: removed `border-b border-gray-200`, added `rounded-xl shadow-lg`.

**Step 2: Verify**

Confirm the search panel looks like a floating card with rounded corners and shadow.

**Step 3: Commit**

```bash
git add src/components/SearchPanel.tsx
git commit -m "style: make SearchPanel a floating card with rounded corners and shadow"
```

---

### Task 4: Style RouteResults as a connected floating card

**Files:**
- Modify: `src/components/RouteResults.tsx:16,26`

**Step 1: Update loading state styling**

Change line 16 from:
```tsx
return <div className="p-4 text-center text-gray-500 text-sm">Searching routes...</div>
```
to:
```tsx
return <div className="p-4 text-center text-gray-500 text-sm bg-white rounded-b-xl shadow-lg mt-px">Searching routes...</div>
```

**Step 2: Update error state styling**

Change line 20 from:
```tsx
return <div className="p-4 text-center text-red-500 text-sm">{error}</div>
```
to:
```tsx
return <div className="p-4 text-center text-red-500 text-sm bg-white rounded-b-xl shadow-lg mt-px">{error}</div>
```

**Step 3: Update results list styling**

Change line 26 from:
```tsx
<div className="flex flex-col gap-2 p-4 overflow-y-auto max-h-96">
```
to:
```tsx
<div className="flex flex-col gap-2 p-3 overflow-y-auto max-h-64 bg-white rounded-b-xl shadow-lg mt-px">
```

Changes: added `bg-white rounded-b-xl shadow-lg mt-px`, reduced `max-h-96` to `max-h-64` (less map coverage), reduced `p-4` to `p-3` for tighter spacing.

**Step 4: Adjust SearchPanel rounding when results are visible**

Since the results panel sits directly below the search panel and has `rounded-b-xl`, we should remove the bottom rounding from SearchPanel when results are showing. This requires passing a prop.

In `src/components/SearchPanel.tsx`, add an optional prop `hasResults`:

```tsx
interface SearchPanelProps {
  onSearch?: (fromPlace: string, toPlace: string, modes: TransportMode[], dateTime?: string) => void
  modes?: TransportMode[]
  hasResults?: boolean
}
```

Update the container div class to conditionally remove bottom rounding:
```tsx
<div className={`flex flex-col gap-3 p-4 bg-white shadow-lg ${hasResults ? 'rounded-t-xl' : 'rounded-xl'}`}>
```

In `page.tsx`, pass the prop:
```tsx
<SearchPanel onSearch={handleSearch} modes={activeModes} hasResults={routes.length > 0 || loading} />
```

**Step 5: Verify**

Confirm: search panel has rounded top corners, results panel has rounded bottom corners, they look like one connected card.

**Step 6: Commit**

```bash
git add src/components/SearchPanel.tsx src/components/RouteResults.tsx src/app/page.tsx
git commit -m "style: make RouteResults a connected floating card below SearchPanel"
```

---

### Task 5: Convert FilterChips to collapsible filter button

**Files:**
- Modify: `src/components/FilterChips.tsx`

**Step 1: Rewrite FilterChips with collapsible behavior**

Replace the entire content of `src/components/FilterChips.tsx` with:

```tsx
'use client'

import { useState } from 'react'
import { TransportMode } from '@/lib/types'
import { MODE_LABELS, MODE_COLORS, ALL_MODES } from '@/lib/constants'

interface FilterChipsProps {
  activeModes: TransportMode[]
  onToggle: (mode: TransportMode) => void
}

export function FilterChips({ activeModes, onToggle }: FilterChipsProps) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="flex items-center gap-1">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 px-3 py-1.5 bg-white rounded-full shadow-md text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
        </svg>
        Filters
      </button>
      <div
        className={`flex items-center gap-1 overflow-hidden transition-all duration-200 ${
          expanded ? 'max-w-md opacity-100' : 'max-w-0 opacity-0'
        }`}
      >
        {ALL_MODES.map((mode) => {
          const active = activeModes.includes(mode)
          return (
            <button
              key={mode}
              onClick={() => onToggle(mode)}
              className={`px-3 py-1 rounded-full text-sm font-medium whitespace-nowrap transition-colors border shadow-sm ${
                active ? 'text-white border-transparent' : 'text-gray-500 bg-white border-gray-300'
              }`}
              style={active ? { backgroundColor: MODE_COLORS[mode] } : undefined}
            >
              {MODE_LABELS[mode]}
            </button>
          )
        })}
      </div>
    </div>
  )
}
```

Key changes:
- Added `expanded` state with `useState(false)`
- Filter icon button toggles `expanded`
- Chips wrapped in a div with `overflow-hidden` and `transition-all duration-200`
- When collapsed: `max-w-0 opacity-0` hides chips
- When expanded: `max-w-md opacity-100` reveals chips with animation
- Removed `border-b border-gray-200 overflow-x-auto` from container
- Added `shadow-sm` to individual chip buttons for floating appearance

**Step 2: Verify**

Confirm: "Filters" button appears below search panel. Clicking it expands the filter chips horizontally. Clicking again collapses them.

**Step 3: Commit**

```bash
git add src/components/FilterChips.tsx
git commit -m "feat: convert FilterChips to collapsible floating button"
```

---

### Task 6: Polish and verify

**Files:**
- Potentially modify: `src/app/page.tsx`, `src/components/AlertBanner.tsx`

**Step 1: Add rounded corners to AlertBanner**

In `src/components/AlertBanner.tsx`, update line 20 from:
```tsx
<div className={`${bgColor} text-white px-4 py-2 flex items-center justify-between text-sm`}>
```
to:
```tsx
<div className={`${bgColor} text-white px-4 py-2 flex items-center justify-between text-sm rounded-b-lg shadow-md`}>
```

**Step 2: Verify full layout on desktop and mobile**

Run: `npm run dev`

Check desktop (>640px):
- Map fills entire viewport
- Search panel floats top-center, max-width ~32rem
- Route results drop down below search panel as connected card
- "Filters" button sits below, left-aligned
- Alert banner sits at top of viewport
- Map controls (zoom, geolocation) visible at top-right
- Clicking map through gaps works (pointer-events-none pass-through)

Check mobile (<640px):
- Search panel stretches near full-width (with px-3 margin)
- Everything else same behavior

**Step 3: Run build to check for errors**

Run: `npm run build`
Expected: successful build with no TypeScript errors.

**Step 4: Commit**

```bash
git add src/components/AlertBanner.tsx
git commit -m "style: add floating style to AlertBanner"
```

---

## Summary of All Changes

| File | Change |
|------|--------|
| `src/components/MapView.tsx` | `flex-1` → `absolute inset-0` |
| `src/app/page.tsx` | Complete layout restructure: `flex flex-col` → `relative` with absolutely positioned floating elements |
| `src/components/SearchPanel.tsx` | `border-b border-gray-200` → `rounded-xl shadow-lg`, add `hasResults` prop for conditional rounding |
| `src/components/RouteResults.tsx` | Add `bg-white rounded-b-xl shadow-lg mt-px`, reduce max-height |
| `src/components/FilterChips.tsx` | Full rewrite: collapsible button with expandable chips |
| `src/components/AlertBanner.tsx` | Add `rounded-b-lg shadow-md` |
