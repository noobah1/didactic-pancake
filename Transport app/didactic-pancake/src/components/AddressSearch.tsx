import { useState } from "react";

// Convert Estonian L-EST97 (EPSG:3301) to lat/lon (WGS84)
function lest97ToLatLon(x: number, y: number): { lat: number; lon: number } {
  // Simple approximation good enough for Estonia
  const lat = (x - 6375000) / 111320 + 58.5;
  const lon = (y - 500000) / (111320 * Math.cos((58.5 * Math.PI) / 180)) + 25.0;
  return { lat, lon };
}

export default function AddressSearch({ onSelect }: { onSelect: (place: any) => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<any[]>([]);

  const handleSearch = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setQuery(value);
    if (value.length < 3) return setResults([]);

    const res = await fetch(
      `https://inaadress.maaamet.ee/inaadress/gazetteer?address=${encodeURIComponent(value)}&results=5&lang=et`
    );
    const data = await res.json();
    setResults(data.addresses || []);
  };

  return (
    <div>
      <input
        type="text"
        value={query}
        onChange={handleSearch}
        placeholder="Otsi aadressi..."
        style={{ width: "100%", padding: "8px" }}
      />
      {results.length > 0 && (
        <ul style={{ border: "1px solid #ccc", listStyle: "none", padding: 0, background: "white" }}>
          {results.map((r, i) => {
            const coords = lest97ToLatLon(
              parseFloat(r.viitepunkt_x || r.x),
              parseFloat(r.viitepunkt_y || r.y)
            );
            return (
              <li
                key={i}
                onClick={() => {
                  setQuery(r.ipikkaadress);
                  setResults([]);
                  onSelect({ ...r, lat: coords.lat, lon: coords.lon });
                }}
                style={{ padding: "8px", cursor: "pointer" }}
              >
                {r.ipikkaadress}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}