"use client";
import { useCallback, useState } from "react";
import {
  CircleMarker,
  MapContainer,
  Marker,
  Polyline,
  Popup,
  TileLayer,
} from "react-leaflet";
import "leaflet/dist/leaflet.css";
import L from "leaflet";

function sqDist(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const dlat = lat1 - lat2;
  const dlng = lng1 - lng2;
  return dlat * dlat + dlng * dlng;
}

function findNearestStopIndex(
  lat: number,
  lng: number,
  stops: Stop[],
  excludeIndex: number
): number {
  let nearest = excludeIndex;
  let minDist = Infinity;
  stops.forEach((stop, i) => {
    if (i === excludeIndex) return;
    const d = sqDist(lat, lng, stop.lat, stop.lng);
    if (d < minDist) {
      minDist = d;
      nearest = i;
    }
  });
  return nearest;
}

const numberedIcon = (
  num: number,
  opts?: { highlighted?: boolean; dragging?: boolean; reordering?: boolean }
) => {
  const border = opts?.highlighted
    ? "box-shadow:0 0 0 3px #185FA5;"
    : opts?.reordering
      ? "box-shadow:0 0 0 3px #185FA5;opacity:0.7;"
      : "";
  const opacity = opts?.dragging ? "opacity:0.85;" : "";
  return L.divIcon({
    html: `<div style="background:#000;color:#fff;border-radius:50%;width:26px;height:26px;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:600;cursor:grab;${border}${opacity}">${num}</div>`,
    className: "",
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  });
};

type Leg = {
  mode: string;
  fromStation?: string | null;
  toStation?: string | null;
  fromStationCoords?: [number, number] | null;
  toStationCoords?: [number, number] | null;
};

type Stop = {
  address: string;
  lat: number;
  lng: number;
  pathCoordinates?: [number, number][];
  legs?: Leg[];
};

type RouteMapProps = {
  stops: Stop[];
  onReorder?: (fromIndex: number, toIndex: number) => void;
  reorderingStopIndex?: number | null;
};

export default function RouteMap({
  stops,
  onReorder,
  reorderingStopIndex,
}: RouteMapProps) {
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const [dropTargetIndex, setDropTargetIndex] = useState<number | null>(null);

  const canDrag = Boolean(onReorder) && reorderingStopIndex == null;

  const handleDrag = useCallback(
    (index: number, e: L.LeafletEvent) => {
      const marker = e.target as L.Marker;
      const pos = marker.getLatLng();
      const nearest = findNearestStopIndex(pos.lat, pos.lng, stops, index);
      setDraggingIndex(index);
      setDropTargetIndex(nearest !== index ? nearest : null);
    },
    [stops]
  );

  const handleDragEnd = useCallback(
    (index: number, e: L.LeafletEvent) => {
      const marker = e.target as L.Marker;
      const pos = marker.getLatLng();
      const toIndex = findNearestStopIndex(pos.lat, pos.lng, stops, index);

      setDraggingIndex(null);
      setDropTargetIndex(null);

      if (toIndex !== index && onReorder) {
        onReorder(index, toIndex);
      } else {
        marker.setLatLng([stops[index].lat, stops[index].lng]);
      }
    },
    [stops, onReorder]
  );

  if (!stops || stops.length === 0) return null;

  const center: [number, number] = [stops[0].lat, stops[0].lng];
  const stationMarkers: { coords: [number, number]; name: string }[] = [];

  stops.forEach((stop) => {
    (stop.legs || []).forEach((leg) => {
      if (leg.mode !== "walking") {
        if (leg.fromStationCoords && leg.fromStation) {
          stationMarkers.push({
            coords: leg.fromStationCoords,
            name: leg.fromStation,
          });
        }
        if (leg.toStationCoords && leg.toStation) {
          stationMarkers.push({
            coords: leg.toStationCoords,
            name: leg.toStation,
          });
        }
      }
    });
  });

  return (
    <div
      style={{
        height: 400,
        width: "100%",
        borderRadius: 12,
        overflow: "hidden",
        marginBottom: 16,
      }}
    >
      <MapContainer
        center={center}
        zoom={13}
        style={{ height: "100%", width: "100%" }}
      >
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution="&copy; OpenStreetMap contributors"
        />
        {stops.map((stop, i) => {
          if (
            i === 0 ||
            !stop.pathCoordinates ||
            stop.pathCoordinates.length === 0
          ) {
            return null;
          }

          return (
            <Polyline
              key={`path-${stop.lat}-${stop.lng}-${i}`}
              positions={stop.pathCoordinates}
              pathOptions={{ color: "#185FA5", weight: 4 }}
            />
          );
        })}
        {stationMarkers.map((marker, i) => (
          <CircleMarker
            key={`station-${i}`}
            center={marker.coords}
            radius={5}
            pathOptions={{
              color: "#185FA5",
              fillColor: "#fff",
              fillOpacity: 1,
              weight: 2,
            }}
          >
            <Popup>{marker.name}</Popup>
          </CircleMarker>
        ))}
        {dropTargetIndex !== null && draggingIndex !== null && (
          <CircleMarker
            key={`drop-ring-${dropTargetIndex}`}
            center={[stops[dropTargetIndex].lat, stops[dropTargetIndex].lng]}
            radius={18}
            pathOptions={{
              color: "#185FA5",
              fillColor: "#185FA5",
              fillOpacity: 0.15,
              weight: 3,
            }}
          />
        )}
        {stops.map((stop, i) => (
          <Marker
            key={`${stop.address}-${stop.lat}-${stop.lng}`}
            position={[stop.lat, stop.lng]}
            icon={numberedIcon(i + 1, {
              highlighted: dropTargetIndex === i && draggingIndex !== i,
              dragging: draggingIndex === i,
              reordering: reorderingStopIndex === i,
            })}
            draggable={canDrag}
            eventHandlers={
              canDrag
                ? {
                    drag: (e) => handleDrag(i, e),
                    dragend: (e) => handleDragEnd(i, e),
                  }
                : undefined
            }
          >
            <Popup>
              <div style={{ minWidth: 150 }}>
                <p
                  style={{
                    fontSize: 13,
                    margin: "0 0 4px",
                    fontWeight: 500,
                  }}
                >
                  {stop.address}
                </p>
                {canDrag && (
                  <p style={{ fontSize: 11, color: "#666", margin: 0 }}>
                    Drag pin to reorder
                  </p>
                )}
              </div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}
