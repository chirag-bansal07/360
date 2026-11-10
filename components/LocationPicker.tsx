'use client';
import 'leaflet/dist/leaflet.css';
import { useEffect, useRef } from 'react';

// Small satellite map with a pin the user can drag onto the exact roof.
export default function LocationPicker({ lat, lng, onChange }: { lat: number | null; lng: number | null; onChange: (lat: number, lng: number) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const map = useRef<any>(null);
  const marker = useRef<any>(null);
  const cb = useRef(onChange);
  cb.current = onChange;

  useEffect(() => {
    let dead = false;
    import('leaflet').then((mod) => {
      const L: any = (mod as any).default || mod;
      if (dead || !host.current || map.current) return;
      const m = L.map(host.current, { zoomControl: true, attributionControl: true }).setView([lat ?? 22.5, lng ?? 79], lat == null ? 4 : 18);
      L.tileLayer('/api/tile/{z}/{x}/{y}', { maxNativeZoom: 18, maxZoom: 21, attribution: 'Imagery © Esri, Maxar' }).addTo(m);
      const icon = L.divIcon({ className: '', html: '<div class="pin"></div>', iconSize: [22, 22], iconAnchor: [11, 22] });
      const mk = L.marker([lat ?? 22.5, lng ?? 79], { draggable: true, icon, opacity: lat == null ? 0 : 1 }).addTo(m);
      mk.on('dragend', () => { const p = mk.getLatLng(); cb.current(p.lat, p.lng); });
      m.on('click', (e: any) => { mk.setLatLng(e.latlng); mk.setOpacity(1); cb.current(e.latlng.lat, e.latlng.lng); });
      map.current = m; marker.current = mk;
    });
    return () => { dead = true; map.current?.remove(); map.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!map.current || lat == null || lng == null) return;
    const cur = marker.current.getLatLng();
    marker.current.setOpacity(1);
    if (Math.abs(cur.lat - lat) > 1e-7 || Math.abs(cur.lng - lng) > 1e-7) {
      marker.current.setLatLng([lat, lng]);
      map.current.setView([lat, lng], Math.max(map.current.getZoom(), 18));
    }
  }, [lat, lng]);

  return <div className="pick-map" ref={host} />;
}
