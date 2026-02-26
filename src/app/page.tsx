import { SearchPanel } from '@/components/SearchPanel'
import { MapView } from '@/components/MapView'

export default function Home() {
  return (
    <main className="h-dvh flex flex-col">
      <SearchPanel />
      <MapView />
    </main>
  )
}
