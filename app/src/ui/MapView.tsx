import { useEffect, useRef, useState } from 'react'
import mapboxgl from 'mapbox-gl'
import type { Zone } from '../core/geo'
import type { Origin, ScoredCandidate } from '../core/types'
import { ORIGIN_COLOURS } from './theme'

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN as string

interface Props {
  origins: Origin[]
  zones: Zone[]
  overlap: Zone | null
  results: ScoredCandidate[]
  selectedId: string | null
  addMode: boolean
  onMapClick: (lng: number, lat: number) => void
  onOriginMove: (id: string, lng: number, lat: number) => void
  onSelect: (id: string | null) => void
}

const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] }

export function MapView(props: Props) {
  const container = useRef<HTMLDivElement>(null)
  const map = useRef<mapboxgl.Map | null>(null)
  const markers = useRef(new Map<string, mapboxgl.Marker>())
  const ready = useRef(false)
  /**
   * Bumped whenever a map instance is built.
   *
   * Markers belong to the map they were added to, so when the map is replaced -- which
   * React does on every mount in development -- the old ones are gone and the effect
   * that creates them has to run again. Without this it only re-runs when the starting
   * points change, so a plan that already had them at mount ends up with none: the
   * panel lists them and the map shows nothing.
   */
  const [mapVersion, setMapVersion] = useState(0)

  // Latest props, readable from handlers the map holds on to. Kept out of the map
  // effect's dependencies so the map is not rebuilt on every parent render, and
  // written in an effect rather than during render, which React does not allow.
  const cb = useRef(props)
  useEffect(() => { cb.current = props })

  function sync() {
    const m = map.current
    if (!m || !ready.current) return
    const { zones, overlap, results, selectedId } = cb.current

    ;(m.getSource('zones') as mapboxgl.GeoJSONSource | undefined)?.setData({
      type: 'FeatureCollection',
      features: zones.map((z, i) => ({
        ...z, properties: { colour: ORIGIN_COLOURS[i % ORIGIN_COLOURS.length] },
      })) as GeoJSON.Feature[],
    })

    ;(m.getSource('overlap') as mapboxgl.GeoJSONSource | undefined)?.setData(
      overlap
        ? { type: 'FeatureCollection', features: [{ ...overlap, properties: {} }] } as GeoJSON.FeatureCollection
        : EMPTY,
    )

    ;(m.getSource('results') as mapboxgl.GeoJSONSource | undefined)?.setData({
      type: 'FeatureCollection',
      features: results.map((r, i) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [r.candidate.lng, r.candidate.lat] },
        properties: {
          id: r.candidate.id,
          rank: i + 1,
          active: r.candidate.id === selectedId,
        },
      })),
    })
  }

  useEffect(() => {
    if (!container.current) return
    ready.current = false
    const m = new mapboxgl.Map({
      container: container.current,
      style: 'mapbox://styles/mapbox/dark-v11',
      center: [-122.33, 37.72],
      zoom: 8.6,
    })
    map.current = m
    markers.current.clear() // the previous map took its markers with it
    setMapVersion((v) => v + 1)

    const initLayers = () => {
      // Idempotent: whichever signal arrives first wins and later ones do nothing.
      if (!m.getStyle() || m.getSource('zones')) return

      m.addSource('zones', { type: 'geojson', data: EMPTY })
      m.addLayer({
        id: 'zones-fill', type: 'fill', source: 'zones',
        paint: { 'fill-color': ['get', 'colour'], 'fill-opacity': 0.1 },
      })
      m.addLayer({
        id: 'zones-line', type: 'line', source: 'zones',
        paint: { 'line-color': ['get', 'colour'], 'line-width': 1.2, 'line-opacity': 0.6 },
      })

      m.addSource('overlap', { type: 'geojson', data: EMPTY })
      m.addLayer({
        id: 'overlap-fill', type: 'fill', source: 'overlap',
        paint: { 'fill-color': '#ffd166', 'fill-opacity': 0.2 },
      })
      m.addLayer({
        id: 'overlap-line', type: 'line', source: 'overlap',
        paint: { 'line-color': '#ffd166', 'line-width': 2 },
      })

      m.addSource('results', { type: 'geojson', data: EMPTY })
      m.addLayer({
        id: 'results-dots', type: 'circle', source: 'results',
        paint: {
          'circle-radius': ['case', ['get', 'active'], 9, ['==', ['get', 'rank'], 1], 7, 5],
          'circle-color': [
            'case', ['get', 'active'], '#ffffff',
            ['==', ['get', 'rank'], 1], '#ffd166', '#7dd3fc',
          ],
          'circle-stroke-width': 1.5,
          'circle-stroke-color': '#0b0f14',
        },
      })

      m.on('click', 'results-dots', (e) => {
        const id = e.features?.[0]?.properties?.id
        if (id) cb.current.onSelect(String(id))
      })
      m.on('mouseenter', 'results-dots', () => { m.getCanvas().style.cursor = 'pointer' })
      m.on('mouseleave', 'results-dots', () => { m.getCanvas().style.cursor = '' })

      ready.current = true
      sync()
    }

    // 'style.load' is the reliable signal; 'load' additionally waits on tiles and can
    // be missed. initLayers guards itself, so registering both is harmless.
    m.on('style.load', initLayers)
    m.on('load', initLayers)

    m.on('click', (e) => {
      // Clicks landing on a result are handled by the layer listener above.
      const hits = ready.current ? m.queryRenderedFeatures(e.point, { layers: ['results-dots'] }) : []
      if (hits.length === 0 && cb.current.addMode) cb.current.onMapClick(e.lngLat.lng, e.lngLat.lat)
    })

    // The container is sized by its ancestors, so its dimensions can settle after the
    // map is constructed; without this the canvas keeps whatever it measured first.
    const ro = new ResizeObserver(() => m.resize())
    ro.observe(container.current)

    return () => {
      ro.disconnect()
      m.remove()
      if (map.current === m) { map.current = null; ready.current = false }
    }
  }, [])

  // Draggable pins, colour-matched to their reachable area.
  useEffect(() => {
    const m = map.current
    if (!m) return
    const live = new Set(props.origins.map((o) => o.id))
    for (const [id, marker] of markers.current) {
      if (!live.has(id)) { marker.remove(); markers.current.delete(id) }
    }

    props.origins.forEach((o, i) => {
      let marker = markers.current.get(o.id)
      if (!marker) {
        const el = document.createElement('div')
        el.style.cssText =
          'width:18px;height:18px;border-radius:50%;border:3px solid #0b0f14;cursor:grab;' +
          'box-shadow:0 0 0 1px rgba(255,255,255,.25)'
        marker = new mapboxgl.Marker({ element: el, draggable: true })
          .setLngLat([o.lng, o.lat])
          .addTo(m)
        marker.on('dragend', () => {
          const { lng, lat } = marker!.getLngLat()
          cb.current.onOriginMove(o.id, lng, lat)
        })
        markers.current.set(o.id, marker)
      }
      marker.getElement().style.background = ORIGIN_COLOURS[i % ORIGIN_COLOURS.length]
      marker.setPopup(new mapboxgl.Popup({ offset: 14, closeButton: false }).setText(o.label))
      const cur = marker.getLngLat()
      if (cur.lng !== o.lng || cur.lat !== o.lat) marker.setLngLat([o.lng, o.lat])
    })
  }, [props.origins, mapVersion])

  useEffect(sync, [props.zones, props.overlap, props.results, props.selectedId])

  // Frame the shared area whenever its shape changes.
  useEffect(() => {
    const m = map.current
    const overlap = props.overlap
    if (!m || !overlap) return

    const fit = () => {
      const coords: number[][] = []
      const g = overlap.geometry
      const rings = g.type === 'Polygon' ? g.coordinates : g.coordinates.flat()
      rings.forEach((ring) => ring.forEach((c) => coords.push(c as number[])))
      if (!coords.length) return
      const lngs = coords.map((c) => c[0])
      const lats = coords.map((c) => c[1])
      m.fitBounds(
        [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]],
        { padding: { top: 60, bottom: 60, left: 360, right: 400 }, duration: 700, maxZoom: 13 },
      )
    }

    // A fit issued before the style is ready is dropped silently.
    if (ready.current) fit()
    else m.once('style.load', fit)
  }, [props.overlap])

  // Sized rather than positioned: mapbox-gl's stylesheet sets .mapboxgl-map to
  // position:relative and loads after Tailwind, so an absolutely positioned container
  // gets overridden and collapses to nothing.
  return <div ref={container} className="h-full w-full" />
}
