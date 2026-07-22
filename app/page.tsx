"use client";
import { useState, useRef } from "react";
import { IconWalk, IconBus, IconTrain, IconBike, IconCar } from "@tabler/icons-react";

type Property = {
  sourcePdfName: string;
  address: string | null;
  agentName: string | null;
  agentEmail: string | null;
  agentPhone: string | null;
  needsReview: boolean;
};

function hasCompleteUKPostcodeClient(address: string | null): boolean {
  if (!address) return false;
  const fullPostcodeRegex = /[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}/i;
  return fullPostcodeRegex.test(address);
}

function formatArrivalTime(date: Date): string {
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export default function Home() {
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [loading, setLoading] = useState(false);
  const [geocodeLoading, setGeocodeLoading] = useState(false);
  const [geocodeError, setGeocodeError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [step, setStep] = useState<"extract" | "plan" | "route">("extract");
  const [geocodedProperties, setGeocodedProperties] = useState<any[]>([]);
  const [startPropertyIndex, setStartPropertyIndex] = useState<number | null>(null);
  const [tourDate, setTourDate] = useState("");
  const [startTime, setStartTime] = useState("");
  const [travelMode, setTravelMode] = useState<
    "publicTransport" | "walking" | "cycling" | "car" | "taxi"
  >("publicTransport");
  const [routeResult, setRouteResult] = useState<any>(null);
  const [routeLoading, setRouteLoading] = useState(false);
  const [routeError, setRouteError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function addFiles(files: FileList) {
    setPendingFiles((prev) => {
      const existingNames = new Set(prev.map((f) => f.name));
      const newOnes = Array.from(files).filter((f) => !existingNames.has(f.name));
      return [...prev, ...newOnes];
    });
  }

  function removePendingFile(name: string) {
    setPendingFiles((prev) => prev.filter((f) => f.name !== name));
  }

  async function handleExtract() {
    if (pendingFiles.length === 0) return;
    setLoading(true);

    const formData = new FormData();
    pendingFiles.forEach((f) => formData.append("files", f));

    const res = await fetch("/api/extract", { method: "POST", body: formData });
    const data = await res.json();

    // Merge into existing results rather than overwrite
    setProperties((prev) => [...prev, ...data.results]);
    setPendingFiles([]); // clear the staging area now that they're processed
    setLoading(false);
  }

  function updateField(index: number, field: keyof Property, value: string) {
    setProperties((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      next[index].needsReview =
        !next[index].address ||
        !next[index].agentEmail ||
        !hasCompleteUKPostcodeClient(next[index].address);
      return next;
    });
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      addFiles(e.dataTransfer.files);
    }
  }

  async function handleContinue() {
    setGeocodeLoading(true);
    setGeocodeError(null);

    try {
      const res = await fetch("/api/geocode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ addresses: properties.map((p) => p.address) }),
      });

      if (!res.ok) {
        throw new Error(`Geocoding request failed: ${res.status}`);
      }

      const data = await res.json();

      // Build a lookup from address -> {lat, lng} so merging is explicit and unambiguous
      const geocodeLookup = new Map<
        string,
        { lat: number | null; lng: number | null; error: string | null }
      >(
        data.results.map((r: any) => [
          r.address ?? "",
          { lat: r.lat, lng: r.lng, error: r.error },
        ])
      );

      const merged = properties.map((p) => {
        const match = geocodeLookup.get(p.address ?? "");
        return {
          ...p,
          lat: match?.lat ?? null,
          lng: match?.lng ?? null,
          geocodeError: match?.error ?? null,
        };
      });

      console.log("Merged geocoded properties:", merged);

      setGeocodedProperties(merged);
      setStep("plan");
    } catch (err: any) {
      setGeocodeError(err.message || "Geocoding failed");
    } finally {
      setGeocodeLoading(false);
    }
  }

  async function handleConfirmRoute() {
    if (startPropertyIndex === null) return;
    setRouteLoading(true);
    setRouteError(null);
    try {
      const res = await fetch("/api/optimize-route", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          properties: geocodedProperties,
          startIndex: startPropertyIndex,
          viewingMinutesDefault: 15,
          tourDate,
          startTime,
          travelMode,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setRouteError(data.error || `Route optimization failed (${res.status})`);
        return;
      }
      setRouteResult(data);
      setStep("route");
    } catch (err: any) {
      setRouteError(err?.message || "Failed to optimize route. Please try again.");
    } finally {
      setRouteLoading(false);
    }
  }

  async function handleDurationChange(stopIndex: number, newMinutes: number) {
    if (!routeResult) return;

    const updatedStops = routeResult.stops.map((s: any, i: number) =>
      i === stopIndex ? { ...s, viewingMinutes: newMinutes } : s
    );

    setRouteLoading(true);
    try {
      const res = await fetch("/api/recalculate-schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderedStops: updatedStops,
          travelMode,
          tourDate,
          startTime,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to recalculate schedule");
      }

      setRouteResult({
        ...routeResult,
        stops: data.stops,
        totalTravelMinutes: data.totalTravelMinutes,
      });
    } catch (err: any) {
      setRouteError(err.message || "Failed to recalculate schedule");
    } finally {
      setRouteLoading(false);
    }
  }

  const allResolved = properties.length > 0 && properties.every((p) => !p.needsReview);
  const canConfirmRoute =
    startPropertyIndex !== null && tourDate !== "" && startTime !== "";

  function buildArrivalTimes(stops: any[]): Date[] {
    const cursor = new Date(`${tourDate}T${startTime}`);
    return stops.map((stop) => {
      cursor.setMinutes(cursor.getMinutes() + (stop.travelMinutesFromPrevious ?? 0));
      const arrival = new Date(cursor);
      cursor.setMinutes(cursor.getMinutes() + (stop.viewingMinutes ?? 0));
      return arrival;
    });
  }

  return (
    <main className="p-8 max-w-4xl mx-auto">
      {step === "extract" && (
        <>
          <h1 className="text-2xl font-medium mb-4">Upload brochures</h1>

          <div
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            className={`mb-4 border-2 border-dashed rounded-lg p-10 text-center cursor-pointer transition-colors ${
              isDragging ? "border-black bg-gray-50" : "border-gray-300"
            }`}
          >
            <p className="text-gray-600">
              Drag and drop PDF brochures here, or click to browse
            </p>
            <p className="text-gray-400 text-sm mt-1">
              You can select multiple files at once, or add more before extracting
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf"
              multiple
              onChange={(e) => e.target.files && addFiles(e.target.files)}
              className="hidden"
            />
          </div>

          {pendingFiles.length > 0 && (
            <div className="mb-6 border rounded-lg p-4">
              <p className="font-medium mb-2">
                {pendingFiles.length} file{pendingFiles.length > 1 ? "s" : ""} ready to extract:
              </p>
              <ul className="mb-3">
                {pendingFiles.map((f) => (
                  <li key={f.name} className="flex justify-between items-center text-sm py-1">
                    <span>{f.name}</span>
                    <button
                      onClick={() => removePendingFile(f.name)}
                      className="text-red-500 text-xs hover:underline"
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
              <button
                onClick={handleExtract}
                disabled={loading}
                className="bg-black text-white px-4 py-2 rounded disabled:opacity-30"
              >
                {loading ? "Extracting..." : `Extract ${pendingFiles.length} file${pendingFiles.length > 1 ? "s" : ""}`}
              </button>
            </div>
          )}

          {loading && (
            <p className="mb-4 text-sm text-gray-500">
              This can take a while for several files — processing in small batches to respect API rate limits.
            </p>
          )}

          {properties.length > 0 && (
            <table className="w-full border-collapse mb-6">
              <thead>
                <tr className="text-left border-b">
                  <th className="p-2">File</th>
                  <th className="p-2">Address</th>
                  <th className="p-2">Agent</th>
                  <th className="p-2">Email</th>
                  <th className="p-2">Phone</th>
                </tr>
              </thead>
              <tbody>
                {properties.map((p, i) => (
                  <tr key={i} className={p.needsReview ? "bg-red-50" : ""}>
                    <td className="p-2 text-sm">
                      {p.sourcePdfName}
                      {(p as any).error && (
                        <div className="text-red-500 text-xs mt-1">{(p as any).error}</div>
                      )}
                    </td>
                    <td className="p-2">
                      <input
                        value={p.address ?? ""}
                        onChange={(e) => updateField(i, "address", e.target.value)}
                        className="border rounded px-2 py-1 w-full"
                        placeholder="Missing or incomplete postcode — enter manually"
                      />
                      {!p.address && (
                        <div className="text-red-500 text-xs mt-1">Address is missing</div>
                      )}
                      {p.address && !hasCompleteUKPostcodeClient(p.address) && (
                        <div className="text-red-500 text-xs mt-1">Postcode looks incomplete — needs the full code (e.g. EC4N 8AD, not just EC4)</div>
                      )}
                    </td>
                    <td className="p-2">
                      <input
                        value={p.agentName ?? ""}
                        onChange={(e) => updateField(i, "agentName", e.target.value)}
                        className="border rounded px-2 py-1 w-full"
                      />
                    </td>
                    <td className="p-2">
                      <input
                        value={p.agentEmail ?? ""}
                        onChange={(e) => updateField(i, "agentEmail", e.target.value)}
                        className="border rounded px-2 py-1 w-full"
                        placeholder="Missing — enter manually"
                      />
                      {!p.agentEmail && (
                        <div className="text-red-500 text-xs mt-1">Agent email is missing</div>
                      )}
                    </td>
                    <td className="p-2">
                      <input
                        value={p.agentPhone ?? ""}
                        onChange={(e) => updateField(i, "agentPhone", e.target.value)}
                        className="border rounded px-2 py-1 w-full"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {geocodeError && (
            <p className="mb-4 text-sm text-red-600">{geocodeError}</p>
          )}

          <button
            onClick={handleContinue}
            disabled={!allResolved || geocodeLoading}
            className="bg-black text-white px-4 py-2 rounded disabled:opacity-30"
          >
            {geocodeLoading ? "Geocoding..." : "Continue"}
          </button>
        </>
      )}

      {step === "plan" && (
        routeLoading ? (
          <p className="text-sm text-gray-500">Optimizing your route…</p>
        ) : (
          <div className="max-w-md">
            <h1 className="text-2xl font-medium mb-6">Plan your tour</h1>

            {routeError && (
              <p className="mb-4 text-sm text-red-600">{routeError}</p>
            )}

            <label className="block mb-4">
              <span className="block text-sm font-medium mb-1">Starting property</span>
              <select
                value={startPropertyIndex ?? ""}
                onChange={(e) =>
                  setStartPropertyIndex(
                    e.target.value === "" ? null : Number(e.target.value)
                  )
                }
                className="border rounded px-2 py-2 w-full"
              >
                <option value="">Select a starting address</option>
                {geocodedProperties.map((p, i) => (
                  <option key={i} value={i}>
                    {p.address}
                  </option>
                ))}
              </select>
            </label>

            <label className="block mb-4">
              <span className="block text-sm font-medium mb-1">Tour date</span>
              <input
                type="date"
                value={tourDate}
                onChange={(e) => setTourDate(e.target.value)}
                className="border rounded px-2 py-2 w-full"
              />
            </label>

            <label className="block mb-4">
              <span className="block text-sm font-medium mb-1">Start time</span>
              <input
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="border rounded px-2 py-2 w-full"
              />
            </label>

            <label className="block mb-6">
              <span className="block text-sm font-medium mb-1">Travel mode</span>
              <select
                value={travelMode}
                onChange={(e) =>
                  setTravelMode(
                    e.target.value as
                      | "publicTransport"
                      | "walking"
                      | "cycling"
                      | "car"
                      | "taxi"
                  )
                }
                className="border rounded px-2 py-2 w-full"
              >
                <option value="publicTransport">Public transport (bus, tube, rail)</option>
                <option value="walking">Walking only</option>
                <option value="cycling">Cycling</option>
                <option value="car">Car (driving)</option>
                <option value="taxi">Taxi / rideshare (estimated)</option>
              </select>
            </label>

            <div className="flex gap-3">
              <button
                onClick={() => setStep("extract")}
                className="border border-gray-300 px-4 py-2 rounded"
              >
                Back
              </button>
              <button
                onClick={handleConfirmRoute}
                disabled={!canConfirmRoute}
                className="bg-black text-white px-4 py-2 rounded disabled:opacity-30"
              >
                Confirm route
              </button>
            </div>
          </div>
        )
      )}

      {step === "route" && routeResult && (
        routeLoading ? (
          <p className="text-sm text-gray-500">Optimizing your route…</p>
        ) : (
          <div className="max-w-md">
            <div
              style={{
                marginBottom: 16,
                paddingBottom: 12,
                borderBottom: "0.5px solid #e5e5e5",
              }}
            >
              <p style={{ fontWeight: 500, fontSize: 16, margin: "0 0 4px" }}>
                Date: {tourDate} - Start time: {startTime}
              </p>
              <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
                <p style={{ fontWeight: 500, fontSize: 16, margin: 0 }}>Your route</p>
                <span style={{ fontSize: 13, color: "#666" }}>
                  {Math.round(routeResult.totalTravelMinutes)} min total travel
                </span>
                <span style={{ fontSize: 13, color: "#666" }}>
                  {routeResult.stops.reduce(
                    (sum: number, s: any) => sum + (s.viewingMinutes || 0),
                    0
                  )}{" "}
                  min total viewing
                </span>
              </div>
            </div>

            <div style={{ position: "relative", paddingLeft: 28 }}>
              <div
                style={{
                  position: "absolute",
                  left: 9,
                  top: 8,
                  bottom: 8,
                  width: 2,
                  background: "#ddd",
                }}
              />
              {(() => {
                const arrivals = buildArrivalTimes(routeResult.stops);
                return routeResult.stops.map((stop: any, i: number) => {
                  const arrivalTime = formatArrivalTime(arrivals[i]);
                  const journeyTotal = stop.travelMinutesFromPrevious ?? 0;

                  return (
                    <div key={i}>
                      {i > 0 && (
                        <div
                          style={{
                            position: "relative",
                            marginBottom: 20,
                            padding: "6px 10px",
                            background: "#f7f7f7",
                            borderRadius: 8,
                            marginLeft: -4,
                          }}
                        >
                          <p
                            style={{
                              fontSize: 12,
                              fontWeight: 500,
                              color: "#333",
                              margin: "0 0 4px",
                            }}
                          >
                            {Math.round(journeyTotal)} min total
                          </p>
                          {stop.unreachable ? (
                            <p style={{ fontSize: 12, color: "#d85a30", margin: 0 }}>
                              {stop.unreachableReason}
                            </p>
                          ) : (
                            stop.legs.map((leg: any, li: number) => {
                              const Icon =
                                leg.mode === "walking"
                                  ? IconWalk
                                  : leg.mode === "bus"
                                    ? IconBus
                                    : leg.mode === "cycle"
                                      ? IconBike
                                      : leg.mode === "car"
                                        ? IconCar
                                        : leg.mode === "taxi"
                                          ? IconCar
                                          : IconTrain;

                              return (
                                <p
                                  key={li}
                                  style={{
                                    fontSize: 12,
                                    color: "#666",
                                    margin: "0 0 2px",
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 6,
                                  }}
                                >
                                  <Icon size={14} stroke={1.75} />
                                  {leg.mode === "walking"
                                    ? `${leg.durationMinutes} min walk`
                                    : `${leg.durationMinutes} min ${leg.mode} - ${leg.lineName}`}
                                </p>
                              );
                            })
                          )}
                          {stop.estimatedEBikeMinutes !== null &&
                            stop.estimatedEBikeMinutes !== undefined && (
                              <p
                                style={{
                                  fontSize: 12,
                                  color: "#666",
                                  margin: "0 0 2px",
                                  display: "flex",
                                  alignItems: "center",
                                  gap: 6,
                                }}
                              >
                                <IconBike size={14} stroke={1.75} />
                                ~{stop.estimatedEBikeMinutes} min estimated e-bike
                                (approximate, not based on live data)
                              </p>
                            )}
                          {stop.estimatedTaxiNote && <div>{stop.estimatedTaxiNote}</div>}
                        </div>
                      )}

                      <div style={{ position: "relative", marginBottom: 20 }}>
                        <div
                          style={{
                            position: "absolute",
                            left: -28,
                            top: 2,
                            width: 20,
                            height: 20,
                            borderRadius: "50%",
                            background: "#000",
                            color: "#fff",
                            fontSize: 11,
                            fontWeight: 500,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          {i + 1}
                        </div>
                        <p style={{ fontSize: 13, color: "#666", margin: "0 0 2px" }}>
                          {arrivalTime}
                        </p>
                        <p style={{ fontWeight: 500, fontSize: 14, margin: 0 }}>
                          {stop.address}
                        </p>
                        <div
                          style={{
                            fontSize: 13,
                            color: "#666",
                            margin: "2px 0 0",
                            display: "flex",
                            alignItems: "center",
                            gap: 4,
                          }}
                        >
                          <span>{stop.agentName || "Agent pending"}</span>
                          <span>-</span>
                          <input
                            type="number"
                            min={5}
                            step={5}
                            value={stop.viewingMinutes ?? 15}
                            onChange={(e) =>
                              handleDurationChange(i, parseInt(e.target.value) || 15)
                            }
                            style={{
                              width: 44,
                              padding: "2px 4px",
                              margin: 0,
                              textAlign: "center",
                              border: "1px solid #999",
                              borderRadius: 4,
                              background: "#fff",
                              color: "#000",
                            }}
                          />
                          <span>min viewing</span>
                        </div>
                      </div>
                    </div>
                  );
                });
              })()}
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setStep("plan")}
                className="border border-gray-300 px-4 py-2 rounded"
              >
                Back
              </button>
              <button
                onClick={() =>
                  alert("Route approved! Email sending comes next.")
                }
                className="bg-black text-white px-4 py-2 rounded"
              >
                Approve route
              </button>
            </div>
          </div>
        )
      )}
    </main>
  );
}
