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

export default function Home() {
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [loading, setLoading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
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

  function handleContinue() {
    console.log("Properties ready for next step:", properties);
    alert(`${properties.length} propert${properties.length === 1 ? "y" : "ies"} confirmed. Next step (geocoding) isn't built yet.`);
  }

  const allResolved = properties.length > 0 && properties.every((p) => !p.needsReview);

  return (
    <main className="p-8 max-w-4xl mx-auto">
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
                <td className="p-2 text-sm">{p.sourcePdfName}</td>
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
        disabled={!allResolved}
        className="bg-black text-white px-4 py-2 rounded disabled:opacity-30"
      >
        Continue
      </button>
    </main>
  );
}