"use client";
import { useState, useRef } from "react";

type Property = {
  sourcePdfName: string;
  address: string | null;
  agentName: string | null;
  agentEmail: string | null;
  agentPhone: string | null;
  needsReview: boolean;
};

type GeocodeResult = {
  address: string;
  lat: number | null;
  lng: number | null;
  error: string | null;
};

export default function Home() {
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [loading, setLoading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [step, setStep] = useState<"extract" | "plan">("extract");
  const [geocodedProperties, setGeocodedProperties] = useState<any[]>([]);
  const [startPropertyIndex, setStartPropertyIndex] = useState<number | null>(null);
  const [tourDate, setTourDate] = useState("");
  const [startTime, setStartTime] = useState("");
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
      next[index].needsReview = !next[index].address || !next[index].agentEmail;
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
    setLoading(true);
    try {
      const addresses = properties.map((p) => p.address as string);
      const res = await fetch("/api/geocode", {
        method: "POST",
        body: JSON.stringify({ addresses }),
        headers: { "Content-Type": "application/json" },
      });
      const data = await res.json();
      const results: GeocodeResult[] = data.results;

      const merged = properties.map((p) => {
        const geo = results.find((r) => r.address === p.address);
        return {
          ...p,
          lat: geo?.lat ?? null,
          lng: geo?.lng ?? null,
          geocodeError: geo?.error ?? null,
        };
      });

      setGeocodedProperties(merged);
      setStep("plan");
    } finally {
      setLoading(false);
    }
  }

  function handleConfirmRoute() {
    if (startPropertyIndex === null) return;
    const plan = {
      startProperty: geocodedProperties[startPropertyIndex],
      tourDate,
      startTime,
      properties: geocodedProperties,
    };
    console.log("Tour plan:", plan);
    alert(
      `Route confirmed starting at ${geocodedProperties[startPropertyIndex].address} on ${tourDate} at ${startTime}. Optimization comes next.`
    );
  }

  const allResolved = properties.length > 0 && properties.every((p) => !p.needsReview);
  const canConfirmRoute =
    startPropertyIndex !== null && tourDate !== "" && startTime !== "";

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
                        placeholder="Missing — enter manually"
                      />
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

          <button
            onClick={handleContinue}
            disabled={!allResolved || loading}
            className="bg-black text-white px-4 py-2 rounded disabled:opacity-30"
          >
            {loading ? "Geocoding..." : "Continue"}
          </button>
        </>
      )}

      {step === "plan" && (
        <div className="max-w-md">
          <h1 className="text-2xl font-medium mb-6">Plan your tour</h1>

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

          <label className="block mb-6">
            <span className="block text-sm font-medium mb-1">Start time</span>
            <input
              type="time"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              className="border rounded px-2 py-2 w-full"
            />
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
      )}
    </main>
  );
}
