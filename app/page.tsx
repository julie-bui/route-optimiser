"use client";
import { useEffect, useRef, useState } from "react";
import { IconWalk, IconBus, IconTrain, IconBike, IconCar, IconChevronUp, IconChevronDown } from "@tabler/icons-react";
import dynamic from "next/dynamic";
import { formatRoundedTime, roundUpMinutesToFive } from "./lib/timeFormat";

const RouteMap = dynamic(() => import("./components/RouteMap"), { ssr: false });

type Contact = {
  name: string | null;
  email: string | null;
  phone: string | null;
};

type Agency = {
  agencyName: string | null;
  contacts: Contact[];
};

type Property = {
  sourcePdfName: string | null;
  address: string | null;
  originalAddressText?: string | null;
  agencies: Agency[];
  selectedEmails: { [agencyIndex: number]: string };
  customEmailMode: { [agencyIndex: number]: boolean };
  manualRecipientSearch?: string;
  manualRecipientEmail?: string;
  manualRecipientName?: string;
  manualRecipientPhone?: string | null;
  lowConfidenceMatch?: boolean;
  userConfirmedAddress?: boolean;
  needsReview: boolean;
};

function hasCompleteUKPostcodeClient(address: string | null): boolean {
  if (!address) return false;
  const fullPostcodeRegex = /[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}/i;
  return fullPostcodeRegex.test(address);
}

function displayAddressWithoutPostcode(address: string): string {
  return address.replace(/,?\s*[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\s*(,\s*(UK|United Kingdom))?\s*$/i, "").trim();
}

function generateFiveMinuteIntervals(): string[] {
  const times: string[] = [];
  for (let h = 0; h < 24; h++) {
    for (let m = 0; m < 60; m += 5) {
      times.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
    }
  }
  return times;
}

const FIVE_MINUTE_INTERVALS = generateFiveMinuteIntervals();

function isValidEmail(email: string): boolean {
  if (!email) return false;
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email.trim());
}

function needsPropertyReview(property: Property): boolean {
  const hasValidRecipient =
    property.agencies.length > 0
      ? property.agencies.every((_, agencyIndex) =>
          isValidEmail(property.selectedEmails?.[agencyIndex] || "")
        )
      : isValidEmail(property.manualRecipientEmail || "");

  return (
    !property.address ||
    (Boolean(property.lowConfidenceMatch) && !property.userConfirmedAddress) ||
    !hasValidRecipient
  );
}

function recomputeManualNeedsReview(property: any): boolean {
  const hasValidRecipient =
    property.manualRecipientEmail &&
    isValidEmail(property.manualRecipientEmail);
  return !property.address || Boolean(property.lowConfidenceMatch) || !hasValidRecipient;
}

function formatArrivalTime(date: Date): string {
  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function useButtonState() {
  const [state, setState] = useState<"idle" | "loading" | "success">("idle");

  const run = async (action: () => Promise<void>) => {
    setState("loading");
    try {
      await action();
      setState("success");
      setTimeout(() => setState("idle"), 2000);
    } catch (err) {
      setState("idle");
      throw err;
    }
  };

  return { state, run };
}

export default function Home() {
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [manualAddressText, setManualAddressText] = useState("");
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
  const [optimizedTotalMinutes, setOptimizedTotalMinutes] = useState<
    number | null
  >(null);
  const [editedDurations, setEditedDurations] = useState<{
    [key: number]: number;
  } | null>(null);
  const [editingDurationText, setEditingDurationText] = useState<{
    [key: number]: string;
  }>({});
  const [routeLoading, setRouteLoading] = useState(false);
  const [reorderingMessage, setReorderingMessage] = useState<string | null>(null);
  const [reorderingStopIndex, setReorderingStopIndex] = useState<number | null>(null);
  const [durationRecalculatingIndex, setDurationRecalculatingIndex] = useState<number | null>(null);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [emailSending, setEmailSending] = useState(false);
  const [emailResults, setEmailResults] = useState<any[] | null>(null);
  const [ccEmails, setCcEmails] = useState<string[]>([""]);
  const [showEmailConfirmation, setShowEmailConfirmation] = useState(false);
  const [emailSubject, setEmailSubject] = useState(
    "Viewing request - {address}"
  );
  const [emailBody, setEmailBody] = useState(`Dear {name},

I'd like to arrange a viewing of {address} on {date} at {time}.

Thank you,
Spacepoint Team`);
  const [scheduleEmailAddress, setScheduleEmailAddress] = useState("");
  const [scheduleEmailSending, setScheduleEmailSending] = useState(false);
  const [scheduleEmailResult, setScheduleEmailResult] = useState<string | null>(
    null
  );
  const [allContacts, setAllContacts] = useState<
    { name: string; company: string; email: string; phone?: string | null }[]
  >([]);
  const [additionalRecipients, setAdditionalRecipients] = useState<
    {
      [propertyIndex: number]: {
        name: string;
        email: string;
        phone?: string | null;
      }[];
    }
  >({});
  const [contactSearchByProperty, setContactSearchByProperty] = useState<{
    [propertyIndex: number]: string;
  }>({});
  const fileInputRef = useRef<HTMLInputElement>(null);
  const recalculateTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
  const recalculateRequestIdRef = useRef(0);
  const editedDurationsRef = useRef(editedDurations);
  editedDurationsRef.current = editedDurations;
  const extractButtonState = useButtonState();
  const continueButtonState = useButtonState();
  const confirmRouteButtonState = useButtonState();
  const downloadScheduleButtonState = useButtonState();
  const emailScheduleButtonState = useButtonState();
  const confirmSendButtonState = useButtonState();

  useEffect(() => {
    return () => {
      if (recalculateTimeoutRef.current) {
        clearTimeout(recalculateTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    fetch("/society-contacts.json")
      .then((res) => res.json())
      .then((data) =>
        setAllContacts(
          (data as any[]).map((contact) => ({
            name: contact.name,
            company: contact.company,
            email: contact.email,
            phone: contact.phone ?? null,
          }))
        )
      )
      .catch((err) => console.error("Failed to load contacts:", err));
  }, []);

  function addFiles(files: FileList) {
    setPendingFiles((prev) => {
      const existingNames = new Set(prev.map((f) => f.name));
      const newOnes = Array.from(files).filter((f) => !existingNames.has(f.name));
      return [...prev, ...newOnes];
    });
  }

  function handleAddManualAddresses() {
    const lines = manualAddressText
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    if (lines.length === 0) return;

    const newProperties = lines.map((address) => ({
      sourcePdfName: null,
      address,
      agencies: [],
      selectedEmails: {},
      customEmailMode: {},
      customEmailNames: {},
      manualRecipientSearch: "",
      manualRecipientEmail: "",
      manualRecipientName: "",
      needsReview: false,
    }));

    setProperties((prev) => [...prev, ...newProperties]);
    setManualAddressText("");
  }

  function removePendingFile(name: string) {
    setPendingFiles((prev) => prev.filter((f) => f.name !== name));
  }

  function removeProperty(index: number) {
    setProperties((prev) => prev.filter((_, i) => i !== index));
  }

  function updateCcEmail(index: number, value: string) {
    setCcEmails((prev) => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
  }

  function addCcEmailField() {
    setCcEmails((prev) => [...prev, ""]);
  }

  function removeCcEmailField(index: number) {
    setCcEmails((prev) => prev.filter((_, i) => i !== index));
  }

  function addRecipient(
    propertyIndex: number,
    contact: { name: string; email: string; phone?: string | null }
  ) {
    setAdditionalRecipients((prev) => {
      const existing = prev[propertyIndex] || [];
      if (existing.some((recipient) => recipient.email === contact.email)) return prev;
      return {
        ...prev,
        [propertyIndex]: [
          ...existing,
          {
            name: contact.name,
            email: contact.email,
            phone: contact.phone || null,
          },
        ],
      };
    });
    setContactSearchByProperty((prev) => ({ ...prev, [propertyIndex]: "" }));
  }

  function removeRecipient(propertyIndex: number, email: string) {
    setAdditionalRecipients((prev) => ({
      ...prev,
      [propertyIndex]: (prev[propertyIndex] || []).filter(
        (recipient) => recipient.email !== email
      ),
    }));
  }

  function getFilteredContacts(propertyIndex: number) {
    const search = contactSearchByProperty[propertyIndex] || "";
    if (search.trim().length === 0) return [];

    return allContacts
      .filter(
        (contact) =>
          contact.name.toLowerCase().includes(search.toLowerCase()) ||
          contact.company.toLowerCase().includes(search.toLowerCase())
      )
      .slice(0, 8);
  }

  function updateManualRecipientSearch(propertyIndex: number, value: string) {
    setProperties((prev) => {
      const next = [...prev];
      next[propertyIndex] = {
        ...next[propertyIndex],
        manualRecipientSearch: value,
      };
      return next;
    });
  }

  function selectManualRecipientFromSearch(
    propertyIndex: number,
    contact: { name: string; email: string; phone?: string | null }
  ) {
    setProperties((prev) => {
      const next = [...prev];
      const updated = {
        ...next[propertyIndex],
        manualRecipientEmail: contact.email,
        manualRecipientName: contact.name,
        manualRecipientPhone: contact.phone || null,
        manualRecipientSearch: "",
      };
      next[propertyIndex] = {
        ...updated,
        needsReview: recomputeManualNeedsReview(updated),
      };
      return next;
    });
  }

  function updateManualRecipientEmail(propertyIndex: number, value: string) {
    setProperties((prev) => {
      const next = [...prev];
      const updated = {
        ...next[propertyIndex],
        manualRecipientEmail: value,
      };
      next[propertyIndex] = {
        ...updated,
        needsReview: recomputeManualNeedsReview(updated),
      };
      return next;
    });
  }

  function updateManualRecipientName(propertyIndex: number, value: string) {
    setProperties((prev) => {
      const next = [...prev];
      const updated = {
        ...next[propertyIndex],
        manualRecipientName: value,
      };
      next[propertyIndex] = {
        ...updated,
        needsReview: recomputeManualNeedsReview(updated),
      };
      return next;
    });
  }

  function getManualSearchResults(propertyIndex: number) {
    const search = properties[propertyIndex]?.manualRecipientSearch || "";
    if (search.trim().length === 0) return [];

    return allContacts
      .filter(
        (contact) =>
          contact.name.toLowerCase().includes(search.toLowerCase()) ||
          contact.company.toLowerCase().includes(search.toLowerCase())
      )
      .slice(0, 8);
  }

  async function handleExtract() {
    if (pendingFiles.length === 0) return;
    setLoading(true);

    try {
      const formData = new FormData();
      pendingFiles.forEach((f) => formData.append("files", f));

      const res = await fetch("/api/extract", { method: "POST", body: formData });
      if (!res.ok) {
        throw new Error(`Extract failed: ${res.status}`);
      }
      const data = await res.json();

      const initialized = data.results.map((property: any) => {
        const initializedProperty: Property = {
          ...property,
          agencies: property.agencies || [],
          selectedEmails: Object.fromEntries(
            (property.agencies || []).map((agency: any, index: number) => [
              index,
              agency.contacts?.[0]?.email || "",
            ])
          ),
          customEmailMode: Object.fromEntries(
            (property.agencies || []).map((_: any, index: number) => [index, false])
          ),
          needsReview: true,
        };

        return {
          ...initializedProperty,
          needsReview: needsPropertyReview(initializedProperty),
        };
      });

      setProperties((prev) => [...prev, ...initialized]);
      setPendingFiles([]); // clear the staging area now that they're processed
    } finally {
      setLoading(false);
    }
  }

  function updateField(index: number, field: "address", value: string) {
    setProperties((prev) => {
      const next = [...prev];
      next[index] = {
        ...next[index],
        [field]: value,
        lowConfidenceMatch: false,
        userConfirmedAddress: false,
      };
      next[index].needsReview = needsPropertyReview(next[index]);
      return next;
    });
  }

  function confirmLowConfidenceAddress(index: number) {
    setProperties((prev) => {
      const next = [...prev];
      next[index] = {
        ...next[index],
        lowConfidenceMatch: false,
        userConfirmedAddress: true,
      };
      next[index].needsReview = needsPropertyReview(next[index]);
      return next;
    });
  }

  function handleAgencyEmailSelect(
    propertyIndex: number,
    agencyIndex: number,
    value: string
  ) {
    setProperties((prev) => {
      const next = [...prev];
      const updated = {
        ...next[propertyIndex],
        customEmailMode: {
          ...next[propertyIndex].customEmailMode,
          [agencyIndex]: value === "__custom__",
        },
        selectedEmails: {
          ...next[propertyIndex].selectedEmails,
          [agencyIndex]: value === "__custom__" ? "" : value,
        },
      };
      next[propertyIndex] = {
        ...updated,
        needsReview: needsPropertyReview(updated),
      };
      return next;
    });
  }

  function handleCustomEmailChange(
    propertyIndex: number,
    agencyIndex: number,
    value: string
  ) {
    setProperties((prev) => {
      const next = [...prev];
      const updated = {
        ...next[propertyIndex],
        selectedEmails: {
          ...next[propertyIndex].selectedEmails,
          [agencyIndex]: value,
        },
      };
      next[propertyIndex] = {
        ...updated,
        needsReview: needsPropertyReview(updated),
      };
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

      // Build a lookup from address -> geocoding result so merging is explicit.
      const geocodeLookup = new Map<
        string,
        {
          lat: number | null;
          lng: number | null;
          confidence: number | null;
          resolvedFormatted: string | null;
          verified: boolean;
          error: string | null;
        }
      >(
        data.results.map((r: any) => [
          r.address ?? "",
          {
            lat: r.lat,
            lng: r.lng,
            confidence: r.confidence ?? null,
            resolvedFormatted: r.resolvedFormatted ?? null,
            verified: r.verified === true,
            error: r.error,
          },
        ])
      );

      const merged = properties.map((p) => {
        const match = geocodeLookup.get(p.address ?? "");
        const isVerified =
          match?.verified === true || p.userConfirmedAddress === true;
        const isLowConfidence = !isVerified;
        const originalAddressText = p.address;
        const resolvedAddress =
          isVerified && match?.resolvedFormatted
            ? match.resolvedFormatted
            : p.address;
        const updated = {
          ...p,
          address: resolvedAddress,
          originalAddressText,
          lat: match?.lat ?? null,
          lng: match?.lng ?? null,
          geocodeError: match?.error ?? null,
          lowConfidenceMatch: isLowConfidence,
        };

        return {
          ...updated,
          needsReview:
            needsPropertyReview(updated) ||
            isLowConfidence ||
            match?.lat == null ||
            match?.lng == null,
        };
      });

      setGeocodedProperties(merged);
      setProperties(merged);

      if (merged.some((property) => property.needsReview)) {
        setGeocodeError("Some addresses need review before continuing.");
        throw new Error("Some addresses need review before continuing.");
      } else {
        setStep("plan");
      }
    } catch (err: any) {
      setGeocodeError(err.message || "Geocoding failed");
      throw err;
    } finally {
      setGeocodeLoading(false);
    }
  }

  async function handleConfirmRoute() {
    const missingFields: string[] = [];

    if (startPropertyIndex === null) missingFields.push("a starting property");
    if (!tourDate) missingFields.push("a tour date");
    if (!startTime) missingFields.push("a start time");
    if (!travelMode) missingFields.push("a travel mode");

    if (missingFields.length > 0) {
      const message = `Please select ${missingFields.join(", ")} before confirming the route.`;
      setRouteError(message);
      throw new Error(message);
    }

    setRouteLoading(true);
    setRouteError(null);
    const propertiesForRoute = geocodedProperties.map(
      (property: any, propertyOriginalIndex: number) => {
        const recipients =
          property.agencies?.length > 0
            ? Object.entries(property.selectedEmails || {})
                .filter(([_, email]: any) => email && isValidEmail(email))
                .map(([agencyIdxStr, email]: any) => {
                  const agencyIdx = parseInt(agencyIdxStr);
                  const agency = property.agencies?.[agencyIdx];
                  const matchedContact = agency?.contacts?.find(
                    (contact: any) => contact.email === email
                  );
                  return {
                    email,
                    name: matchedContact?.name || null,
                    phone: matchedContact?.phone || null,
                  };
                })
            : isValidEmail(property.manualRecipientEmail || "")
              ? [
                  {
                    email: property.manualRecipientEmail,
                    name: property.manualRecipientName || null,
                    phone: property.manualRecipientPhone || null,
                  },
                ]
              : [];
        const extraRecipients = (
          additionalRecipients[propertyOriginalIndex] || []
        ).map((recipient) => ({
          email: recipient.email,
          name: recipient.name,
          phone: recipient.phone || null,
        }));
        const allRecipients = [...recipients, ...extraRecipients];

        return {
          ...property,
          recipients: allRecipients,
          recipientEmails: allRecipients.map((recipient) => recipient.email),
        };
      }
    );

    try {
      const res = await fetch("/api/optimize-route", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          properties: propertiesForRoute,
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
        throw new Error(data.error || `Route optimization failed (${res.status})`);
      }
      setRouteResult(data);
      setOptimizedTotalMinutes(data.totalTravelMinutes);
      setEditedDurations(
        Object.fromEntries(
          data.stops.map((s: any, i: number) => [i, s.viewingMinutes ?? 15])
        )
      );
      setStep("route");
    } catch (err: any) {
      setRouteError(err?.message || "Failed to optimize route. Please try again.");
      throw err;
    } finally {
      setRouteLoading(false);
    }
  }

  async function handleRecalculateClick(editedFromIndex?: number) {
    const durations = editedDurationsRef.current;
    if (!durations || !routeResult) return;

    const thisRequestId = ++recalculateRequestIdRef.current;

    const updatedStops = routeResult.stops.map((s: any, i: number) => ({
      ...s,
      viewingMinutes: durations[i] ?? s.viewingMinutes ?? 15,
    }));

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
          ...(editedFromIndex !== undefined ? { editedFromIndex } : {}),
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to recalculate schedule");
      }

      if (thisRequestId !== recalculateRequestIdRef.current) {
        return;
      }

      setRouteResult({
        ...routeResult,
        stops: data.stops,
        totalTravelMinutes: data.totalTravelMinutes,
      });
      setEditedDurations(
        Object.fromEntries(
          data.stops.map((s: any, i: number) => [i, s.viewingMinutes ?? 15])
        )
      );
    } catch (err: any) {
      if (thisRequestId === recalculateRequestIdRef.current) {
        setRouteError(err.message || "Failed to recalculate schedule");
      }
      throw err;
    } finally {
      if (thisRequestId === recalculateRequestIdRef.current) {
        setRouteLoading(false);
        setDurationRecalculatingIndex(null);
      }
    }
  }

  function reorderStops(fromIndex: number, toIndex: number) {
    if (!routeResult || fromIndex === toIndex) return;

    const thisRequestId = ++recalculateRequestIdRef.current;

    const durations = editedDurationsRef.current;
    const withDurations = routeResult.stops.map((s: any, i: number) => ({
      ...s,
      viewingMinutes: durations?.[i] ?? s.viewingMinutes ?? 15,
    }));

    const reordered = [...withDurations];
    const [moved] = reordered.splice(fromIndex, 1);
    reordered.splice(toIndex, 0, moved);

    setRouteLoading(true);
    setRouteError(null);

    fetch("/api/recalculate-schedule", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        orderedStops: reordered,
        travelMode,
        tourDate,
        startTime,
      }),
    })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || "Failed to reorder stops");
        }
        return data;
      })
      .then((data) => {
        if (thisRequestId !== recalculateRequestIdRef.current) {
          return;
        }
        setRouteResult((prev: any) =>
          prev
            ? {
                ...prev,
                stops: data.stops,
                totalTravelMinutes: data.totalTravelMinutes,
              }
            : prev
        );
        setEditedDurations(
          Object.fromEntries(
            data.stops.map((s: any, i: number) => [i, s.viewingMinutes ?? 15])
          )
        );
        setEditingDurationText({});
      })
      .catch((err) => {
        if (thisRequestId === recalculateRequestIdRef.current) {
          setRouteError(err.message || "Failed to reorder stops");
        }
      })
      .finally(() => {
        if (thisRequestId === recalculateRequestIdRef.current) {
          setRouteLoading(false);
          setReorderingMessage(null);
          setReorderingStopIndex(null);
        }
      });
  }

  function moveStop(index: number, direction: "up" | "down") {
    if (!routeResult) return;
    const newIndex = direction === "up" ? index - 1 : index + 1;
    if (newIndex < 0 || newIndex >= routeResult.stops.length) return;
    setReorderingMessage("Recalculating your route order...");
    setReorderingStopIndex(index);
    reorderStops(index, newIndex);
  }

  async function handleDownloadSchedule() {
    const res = await fetch("/api/export-schedule", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        stops: routeResult.stops,
        travelMode,
      }),
    });

    if (!res.ok) {
      throw new Error(`Download failed: ${res.status}`);
    }

    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `tour-schedule-${tourDate}.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
  }

  async function handleEmailSchedule() {
    if (!scheduleEmailAddress || !isValidEmail(scheduleEmailAddress)) {
      setScheduleEmailResult("Please enter a valid email address");
      throw new Error("Please enter a valid email address");
    }

    setScheduleEmailSending(true);
    setScheduleEmailResult(null);

    try {
      const res = await fetch("/api/email-schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stops: routeResult.stops,
          recipientEmail: scheduleEmailAddress,
          tourDate,
        }),
      });
      const data = await res.json();

      if (!res.ok || data.error) {
        setScheduleEmailResult(`Failed: ${data.error || "Unknown error"}`);
        throw new Error(data.error || "Unknown error");
      } else {
        setScheduleEmailResult(`Sent to ${scheduleEmailAddress}`);
      }
    } catch (err: any) {
      const message = err?.message || "Unknown error";
      if (
        message !== "Please enter a valid email address" &&
        !String(scheduleEmailResult || "").startsWith("Failed:")
      ) {
        setScheduleEmailResult(`Failed: ${message}`);
      }
      throw err;
    } finally {
      setScheduleEmailSending(false);
    }
  }

  const filledCcEmails = ccEmails
    .map((email) => email.trim())
    .filter((email) => email.length > 0);
  const invalidCcEmails = filledCcEmails.filter((email) => !isValidEmail(email));

  function handleApproveRouteClick() {
    if (!routeResult) return;

    if (invalidCcEmails.length > 0) {
      setEmailResults([
        {
          address: "CC email",
          status: "failed",
          reason: `One or more CC email addresses are not valid: ${invalidCcEmails.join(", ")}`,
        },
      ]);
      return;
    }

    const invalidAgentEmails = routeResult.stops.filter(
      (stop: any) =>
        !stop.recipientEmails || stop.recipientEmails.length === 0
    );
    if (invalidAgentEmails.length > 0) {
      setEmailResults(
        invalidAgentEmails.map((stop: any) => ({
          address: stop.address,
          status: "failed",
          reason:
            "This property has no valid agent email - go back and fix it before sending.",
        }))
      );
      return;
    }

    setEmailResults(null);
    setShowEmailConfirmation(true);
  }

  async function handleConfirmSend() {
    if (!routeResult) return;

    setShowEmailConfirmation(false);
    setEmailSending(true);
    setEmailResults(null);

    try {
      const res = await fetch("/api/send-emails", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stops: routeResult.stops,
          tourDate,
          ccEmails: filledCcEmails.length > 0 ? filledCcEmails : undefined,
          emailSubject,
          emailBody,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || `Send failed: ${res.status}`);
      }
      setEmailResults(data.results);
    } catch (err: any) {
      setEmailResults([
        { address: "N/A", status: "failed", reason: err.message },
      ]);
      throw err;
    } finally {
      setEmailSending(false);
    }
  }

  function handleCancelSend() {
    setShowEmailConfirmation(false);
  }

  const allResolved =
    properties.length > 0 && properties.every((property) => !needsPropertyReview(property));
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
    <main className="p-8 max-w-6xl mx-auto">
      {step === "extract" && (
        <div className="max-w-4xl mx-auto">
          <h1 className="text-2xl font-medium mb-4">Upload brochures</h1>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 12,
              marginBottom: 16,
            }}
          >
            <div
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
              className={`border-2 border-dashed rounded-lg p-10 text-center cursor-pointer transition-colors ${
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

            <div style={{ border: "1px solid #ddd", borderRadius: 12, padding: 16 }}>
              <p style={{ fontSize: 13, color: "#666", margin: "0 0 8px" }}>
                Or paste addresses (one per line)
              </p>
              <textarea
                value={manualAddressText}
                onChange={(e) => setManualAddressText(e.target.value)}
                rows={3}
                placeholder="150 Waterloo Road, SE1 8SB"
                style={{
                  width: "100%",
                  fontSize: 13,
                  padding: 8,
                  border: "1px solid #999",
                  borderRadius: 4,
                }}
              />
              <button
                onClick={handleAddManualAddresses}
                style={{ marginTop: 8, fontSize: 13, padding: "6px 12px" }}
              >
                Add addresses
              </button>
            </div>
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
                onClick={() => {
                  void extractButtonState.run(handleExtract).catch(() => {});
                }}
                disabled={loading || extractButtonState.state === "loading"}
                className="bg-black text-white px-4 py-2 rounded disabled:opacity-30"
                style={{
                  opacity: extractButtonState.state === "loading" ? 0.6 : 1,
                  borderColor:
                    extractButtonState.state === "success"
                      ? "var(--border-success, #0f6e56)"
                      : undefined,
                  color:
                    extractButtonState.state === "success"
                      ? "var(--text-success, #0f6e56)"
                      : undefined,
                }}
              >
                {extractButtonState.state === "loading"
                  ? "Extracting..."
                  : extractButtonState.state === "success"
                    ? "✓ Extracted"
                    : `Extract ${pendingFiles.length} file${pendingFiles.length > 1 ? "s" : ""}`}
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
                  <th className="p-2">Agencies</th>
                  <th className="p-2"></th>
                </tr>
              </thead>
              <tbody>
                {properties.map((p, i) => (
                  <tr key={i} className={p.needsReview ? "bg-red-50" : ""}>
                    <td className="p-2 text-sm" style={{ verticalAlign: "top" }}>
                      <label style={{ fontSize: 11, color: "transparent", display: "block", marginBottom: 4 }}>
                        File
                      </label>
                      {p.sourcePdfName}
                      {(p as any).error && (
                        <div className="text-red-500 text-xs mt-1">{(p as any).error}</div>
                      )}
                    </td>
                    <td className="p-2" style={{ verticalAlign: "top" }}>
                      <label style={{ fontSize: 11, color: "#666", display: "block", marginBottom: 4 }}>
                        Address
                      </label>
                      <input
                        value={p.address ?? ""}
                        onChange={(e) => updateField(i, "address", e.target.value)}
                        className="border rounded px-2 py-1 w-full"
                        placeholder="Missing or incomplete postcode — enter manually"
                        style={{ minWidth: 280 }}
                      />
                      {!p.address && (
                        <div className="text-red-500 text-xs mt-1">Address is missing</div>
                      )}
                      {p.address && p.lowConfidenceMatch && (
                        <div className="text-red-500 text-xs mt-1">
                          This address couldn&apos;t be matched confidently — please check it or add more detail.{" "}
                          <button
                            onClick={() => confirmLowConfidenceAddress(i)}
                            style={{
                              color: "#0f6e56",
                              textDecoration: "underline",
                              background: "none",
                              border: "none",
                              cursor: "pointer",
                              fontSize: 11,
                              padding: 0,
                            }}
                          >
                            I&apos;ve checked, this is correct
                          </button>
                        </div>
                      )}
                    </td>
                    <td className="p-2" style={{ verticalAlign: "top" }}>
                      {p.agencies && p.agencies.length > 0 ? (
                        <>
                      {p.agencies.map((agency, agencyIdx) => (
                        <div key={agencyIdx} style={{ marginBottom: 10 }}>
                          <p style={{ fontSize: 12, color: "#666", margin: "0 0 4px" }}>
                            {agency.agencyName || "Agency"}
                          </p>
                          <select
                            value={
                              p.customEmailMode?.[agencyIdx]
                                ? "__custom__"
                                : (p.selectedEmails?.[agencyIdx] || "")
                            }
                            onChange={(e) =>
                              handleAgencyEmailSelect(i, agencyIdx, e.target.value)
                            }
                            style={{
                              width: "100%",
                              minWidth: 260,
                              marginBottom: 4,
                              padding: "4px 6px",
                            }}
                          >
                            {agency.contacts.map((contact, contactIdx) => (
                              <option key={contactIdx} value={contact.email || ""}>
                                {contact.name || "Contact"} - {contact.email || "no email"}
                              </option>
                            ))}
                            <option value="__custom__">Type a different email</option>
                          </select>
                          {p.customEmailMode?.[agencyIdx] && (
                            <input
                              type="email"
                              value={p.selectedEmails?.[agencyIdx] || ""}
                              onChange={(e) =>
                                handleCustomEmailChange(i, agencyIdx, e.target.value)
                              }
                              placeholder="name@example.com"
                              style={{ width: "100%", minWidth: 260, padding: "4px 6px" }}
                            />
                          )}
                          {p.selectedEmails?.[agencyIdx] &&
                            !isValidEmail(p.selectedEmails[agencyIdx]) && (
                              <div style={{ color: "#d85a30", fontSize: 12, marginTop: 2 }}>
                                This doesn&apos;t look like a valid email address
                              </div>
                            )}
                        </div>
                      ))}
                      <div
                        style={{
                          marginTop: 10,
                          borderTop: "1px solid #eee",
                          paddingTop: 8,
                        }}
                      >
                        <label
                          style={{
                            fontSize: 11,
                            color: "#666",
                            display: "block",
                            marginBottom: 4,
                          }}
                        >
                          Add someone else to notify (optional)
                        </label>
                        <input
                          type="text"
                          value={contactSearchByProperty[i] || ""}
                          onChange={(e) =>
                            setContactSearchByProperty((prev) => ({
                              ...prev,
                              [i]: e.target.value,
                            }))
                          }
                          placeholder="Search by name or company"
                          style={{
                            width: 260,
                            padding: "4px 6px",
                            border: "1px solid #999",
                            borderRadius: 4,
                            background: "#fff",
                            color: "#000",
                            fontSize: 12,
                          }}
                        />

                        {getFilteredContacts(i).length > 0 && (
                          <div
                            style={{
                              border: "1px solid #ddd",
                              borderRadius: 6,
                              marginTop: 4,
                              width: 300,
                              overflow: "hidden",
                            }}
                          >
                            {getFilteredContacts(i).map((contact, contactIndex) => (
                              <div
                                key={contact.email}
                                style={{
                                  display: "flex",
                                  justifyContent: "space-between",
                                  alignItems: "center",
                                  padding: "6px 8px",
                                  borderBottom:
                                    contactIndex < getFilteredContacts(i).length - 1
                                      ? "1px solid #eee"
                                      : "none",
                                  fontSize: 11,
                                }}
                              >
                                <div>
                                  <p style={{ margin: 0 }}>{contact.name}</p>
                                  <p style={{ margin: 0, color: "#666" }}>
                                    {contact.company} - {contact.email}
                                  </p>
                                </div>
                                <button
                                  onClick={() => addRecipient(i, contact)}
                                  style={{ fontSize: 11, padding: "3px 8px" }}
                                >
                                  Add
                                </button>
                              </div>
                            ))}
                          </div>
                        )}

                        {(additionalRecipients[i] || []).length > 0 && (
                          <div
                            style={{
                              marginTop: 6,
                              display: "flex",
                              flexWrap: "wrap",
                              gap: 4,
                            }}
                          >
                            {(additionalRecipients[i] || []).map(
                              (recipient) => (
                                <span
                                  key={recipient.email}
                                  style={{
                                    fontSize: 11,
                                    background: "#f1f1f1",
                                    borderRadius: 4,
                                    padding: "3px 6px",
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 4,
                                  }}
                                >
                                  {recipient.name}
                                  <button
                                    onClick={() =>
                                      removeRecipient(i, recipient.email)
                                    }
                                    style={{
                                      border: "none",
                                      background: "none",
                                      cursor: "pointer",
                                      color: "#d85a30",
                                      fontSize: 11,
                                      padding: 0,
                                    }}
                                  >
                                    x
                                  </button>
                                </span>
                              )
                            )}
                          </div>
                        )}
                      </div>
                        </>
                      ) : (
                        <div>
                          <label
                            style={{
                              fontSize: 11,
                              color: "#666",
                              display: "block",
                              marginBottom: 4,
                            }}
                          >
                            Agent Email
                          </label>
                          <input
                            type="text"
                            value={p.manualRecipientSearch || ""}
                            onChange={(e) =>
                              updateManualRecipientSearch(i, e.target.value)
                            }
                            placeholder="Search contacts by name or company"
                            style={{
                              width: 260,
                              padding: "4px 6px",
                              border: "1px solid #999",
                              borderRadius: 4,
                              background: "#fff",
                              color: "#000",
                              fontSize: 12,
                              marginBottom: 6,
                            }}
                          />

                          {getManualSearchResults(i).length > 0 && (
                            <div
                              style={{
                                border: "1px solid #ddd",
                                borderRadius: 6,
                                marginBottom: 8,
                                width: 300,
                                overflow: "hidden",
                              }}
                            >
                              {getManualSearchResults(i).map(
                                (contact, contactIndex) => (
                                  <div
                                    key={contact.email}
                                    style={{
                                      display: "flex",
                                      justifyContent: "space-between",
                                      alignItems: "center",
                                      padding: "6px 8px",
                                      borderBottom:
                                        contactIndex <
                                        getManualSearchResults(i).length - 1
                                          ? "1px solid #eee"
                                          : "none",
                                      fontSize: 11,
                                    }}
                                  >
                                    <div>
                                      <p style={{ margin: 0 }}>{contact.name}</p>
                                      <p style={{ margin: 0, color: "#666" }}>
                                        {contact.company} - {contact.email}
                                      </p>
                                    </div>
                                    <button
                                      onClick={() =>
                                        selectManualRecipientFromSearch(i, contact)
                                      }
                                      style={{ fontSize: 11, padding: "3px 8px" }}
                                    >
                                      Select
                                    </button>
                                  </div>
                                )
                              )}
                            </div>
                          )}

                          {p.manualRecipientEmail && (
                            <p
                              style={{
                                fontSize: 11,
                                color: "#0f6e56",
                                margin: "0 0 6px",
                              }}
                            >
                              Selected: {p.manualRecipientName || "(no name)"} -{" "}
                              {p.manualRecipientEmail}
                            </p>
                          )}

                          <p style={{ fontSize: 11, color: "#999", margin: "4px 0" }}>
                            Or enter manually
                          </p>
                          <input
                            type="email"
                            value={p.manualRecipientEmail || ""}
                            onChange={(e) =>
                              updateManualRecipientEmail(i, e.target.value)
                            }
                            placeholder="name@example.com"
                            style={{
                              width: 260,
                              padding: "4px 6px",
                              border: "1px solid #999",
                              borderRadius: 4,
                              background: "#fff",
                              color: "#000",
                              fontSize: 12,
                              marginBottom: 4,
                            }}
                          />
                          {p.manualRecipientEmail &&
                            !isValidEmail(p.manualRecipientEmail) && (
                              <div
                                style={{
                                  color: "#d85a30",
                                  fontSize: 11,
                                  marginTop: 2,
                                }}
                              >
                                This doesn&apos;t look like a valid email address
                              </div>
                            )}
                          {p.needsReview && (
                            <div
                              style={{
                                color: "#d85a30",
                                fontSize: 11,
                                marginTop: 4,
                              }}
                            >
                              {p.lowConfidenceMatch
                                ? "This address couldn't be matched confidently - please check it or add a postcode"
                                : "Select or enter a valid recipient email"}
                            </div>
                          )}
                          <input
                            type="text"
                            value={p.manualRecipientName || ""}
                            onChange={(e) =>
                              updateManualRecipientName(i, e.target.value)
                            }
                            placeholder="Name (optional)"
                            style={{
                              width: 260,
                              padding: "4px 6px",
                              border: "1px solid #999",
                              borderRadius: 4,
                              background: "#fff",
                              color: "#000",
                              fontSize: 12,
                              marginTop: 4,
                            }}
                          />
                        </div>
                      )}
                    </td>
                    <td className="p-2">
                      <button
                        onClick={() => removeProperty(i)}
                        style={{
                          color: "#d85a30",
                          fontSize: 13,
                          border: "none",
                          background: "none",
                          cursor: "pointer",
                        }}
                      >
                        Delete
                      </button>
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
            onClick={() => {
              void continueButtonState.run(handleContinue).catch(() => {});
            }}
            disabled={
              !allResolved ||
              geocodeLoading ||
              continueButtonState.state === "loading"
            }
            className="bg-black text-white px-4 py-2 rounded disabled:opacity-30"
            style={{
              opacity: continueButtonState.state === "loading" ? 0.6 : 1,
              borderColor:
                continueButtonState.state === "success"
                  ? "var(--border-success, #0f6e56)"
                  : undefined,
              color:
                continueButtonState.state === "success"
                  ? "var(--text-success, #0f6e56)"
                  : undefined,
            }}
          >
            {continueButtonState.state === "loading"
              ? "Checking addresses..."
              : continueButtonState.state === "success"
                ? "✓ Ready"
                : "Continue"}
          </button>
        </div>
      )}

      {step === "plan" && (
        routeLoading ? (
          <p className="max-w-4xl mx-auto text-center text-sm text-gray-500">
            Optimizing your route…
          </p>
        ) : (
          <div className="max-w-4xl mx-auto">
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
                    {displayAddressWithoutPostcode(
                      p.originalAddressText || p.address
                    )}
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
              min={new Date().toISOString().split("T")[0]}
                className="border rounded px-2 py-2 w-full"
              />
            </label>

            <label className="block mb-4">
              <span className="block text-sm font-medium mb-1">Start time</span>
              <select
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                style={{
                  padding: "6px 8px",
                  border: "1px solid #999",
                  borderRadius: 4,
                  background: "#fff",
                  color: "#000",
                }}
              >
                <option value="">Select a time</option>
                {FIVE_MINUTE_INTERVALS.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
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
                onClick={() => {
                  void confirmRouteButtonState
                    .run(handleConfirmRoute)
                    .catch(() => {});
                }}
                disabled={confirmRouteButtonState.state === "loading"}
                className="bg-black text-white px-4 py-2 rounded disabled:opacity-30"
                style={{
                  opacity: confirmRouteButtonState.state === "loading" ? 0.6 : 1,
                  borderColor:
                    confirmRouteButtonState.state === "success"
                      ? "var(--border-success, #0f6e56)"
                      : undefined,
                  color:
                    confirmRouteButtonState.state === "success"
                      ? "var(--text-success, #0f6e56)"
                      : undefined,
                }}
              >
                {confirmRouteButtonState.state === "loading"
                  ? "Calculating..."
                  : confirmRouteButtonState.state === "success"
                    ? "✓ Route ready"
                    : "Confirm route"}
              </button>
            </div>
          </div>
        )
      )}

      {step === "route" && routeResult && (
          <div className="max-w-4xl mx-auto">
            {routeLoading && (
              <p style={{ fontSize: 12, color: "#999", marginBottom: 8 }}>
                {reorderingMessage || "Updating schedule…"}
              </p>
            )}
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
                  {Math.round(routeResult.totalTravelMinutes)} min total travel (
                  {roundUpMinutesToFive(routeResult.totalTravelMinutes)} min rounded up)
                </span>
                <span style={{ fontSize: 13, color: "#666" }}>
                  {routeResult.stops.reduce(
                    (sum: number, s: any) => sum + (s.viewingMinutes || 0),
                    0
                  )}{" "}
                  min total viewing
                </span>
              </div>
              {optimizedTotalMinutes !== null &&
                Math.round(routeResult.totalTravelMinutes) !==
                  Math.round(optimizedTotalMinutes) && (
                  <p style={{ fontSize: 12, color: "#999", margin: "4px 0 0" }}>
                    Optimized order was {Math.round(optimizedTotalMinutes)} min
                    total travel
                  </p>
                )}
            </div>

            <RouteMap stops={routeResult.stops} />

            <div style={{ position: "relative", paddingLeft: 68 }}>
              <div
                style={{
                  position: "absolute",
                  left: 49,
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
                            {Math.round(journeyTotal)} min total (
                            {roundUpMinutesToFive(journeyTotal)} min rounded up)
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
                                <div key={li}>
                                  <div
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
                                  </div>
                                  {leg.fromStation && leg.toStation && (
                                    <div
                                      style={{
                                        paddingLeft: 20,
                                        fontSize: 11,
                                        color: "#999",
                                      }}
                                    >
                                      {leg.fromStation} - {leg.toStation}
                                    </div>
                                  )}
                                </div>
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

                      <div
                        style={{
                          position: "relative",
                          marginBottom: 20,
                        }}
                      >
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
                        <div
                          style={{
                            position: "absolute",
                            left: -60,
                            top: 0,
                            display: "flex",
                            flexDirection: "column",
                            gap: 4,
                          }}
                        >
                          {i > 0 && (
                            <button
                              type="button"
                              onClick={() => moveStop(i, "up")}
                              disabled={routeLoading}
                              aria-label="Move stop up"
                              style={{
                                width: 32,
                                height: 32,
                                padding: 0,
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                border: "1px solid #999",
                                borderRadius: 4,
                                background: "#fff",
                                cursor: routeLoading ? "not-allowed" : "pointer",
                                opacity: routeLoading ? 0.5 : 1,
                              }}
                            >
                              <IconChevronUp size={20} stroke={1.75} />
                            </button>
                          )}
                          {i < routeResult.stops.length - 1 && (
                            <button
                              type="button"
                              onClick={() => moveStop(i, "down")}
                              disabled={routeLoading}
                              aria-label="Move stop down"
                              style={{
                                width: 32,
                                height: 32,
                                padding: 0,
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                border: "1px solid #999",
                                borderRadius: 4,
                                background: "#fff",
                                cursor: routeLoading ? "not-allowed" : "pointer",
                                opacity: routeLoading ? 0.5 : 1,
                              }}
                            >
                              <IconChevronDown size={20} stroke={1.75} />
                            </button>
                          )}
                          {reorderingStopIndex === i && (
                            <p style={{ fontSize: 16, fontWeight: 500, color: "#185FA5", marginTop: 6, marginBottom: 6, whiteSpace: "nowrap" }}>
                              Recalculating…
                            </p>
                          )}
                        </div>
                        <p style={{ fontSize: 13, color: "#666", margin: "0 0 2px" }}>
                          {arrivalTime}
                          {i > 0 && (
                            <>
                              {" "}
                              <span style={{ color: "#999" }}>
                                ({formatRoundedTime(arrivals[i].toISOString())} rounded up 5 min)
                              </span>
                            </>
                          )}
                        </p>
                        <p style={{ fontWeight: 500, fontSize: 14, margin: 0 }}>
                          {stop.address}
                        </p>
                        <p style={{ fontSize: 13, color: "#666", margin: "2px 0 0" }}>
                          {stop.recipientEmails && stop.recipientEmails.length > 0
                            ? stop.recipientEmails.join(", ")
                            : "No agent email selected"}
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
                          <input
                            type="number"
                            min={5}
                            step={5}
                            value={
                              editingDurationText[i] ??
                              String(
                                editedDurations?.[i] ??
                                  stop.viewingMinutes ??
                                  15
                              )
                            }
                            onChange={(e) => {
                              const rawValue = e.target.value;
                              setEditingDurationText((prev) => ({
                                ...prev,
                                [i]: rawValue,
                              }));

                              const parsed = parseInt(rawValue, 10);
                              const previousValue =
                                editedDurations?.[i] ?? stop.viewingMinutes;

                              if (rawValue === "" || isNaN(parsed)) {
                                return;
                              }

                              const nextDurations = {
                                ...(editedDurationsRef.current ?? {}),
                                [i]: parsed,
                              };
                              editedDurationsRef.current = nextDurations;
                              setEditedDurations(nextDurations);

                              if (parsed !== previousValue) {
                                if (recalculateTimeoutRef.current) {
                                  clearTimeout(recalculateTimeoutRef.current);
                                }
                                setDurationRecalculatingIndex(i);
                                recalculateTimeoutRef.current = setTimeout(
                                  () => {
                                    void handleRecalculateClick(i).catch(
                                      () => {}
                                    );
                                  },
                                  600
                                );
                              }
                            }}
                            onBlur={() => {
                              if (
                                !editingDurationText[i] ||
                                isNaN(parseInt(editingDurationText[i], 10))
                              ) {
                                const fallback =
                                  editedDurations?.[i] ??
                                  stop.viewingMinutes ??
                                  15;
                                const nextDurations = {
                                  ...(editedDurationsRef.current ?? {}),
                                  [i]: fallback,
                                };
                                editedDurationsRef.current = nextDurations;
                                setEditedDurations(nextDurations);
                              }
                              setEditingDurationText((prev) => {
                                const next = { ...prev };
                                delete next[i];
                                return next;
                              });
                            }}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                if (recalculateTimeoutRef.current) {
                                  clearTimeout(recalculateTimeoutRef.current);
                                }
                                setDurationRecalculatingIndex(i);
                                void handleRecalculateClick(i).catch(() => {});
                                e.currentTarget.blur();
                              }
                            }}
                            style={{
                              width: 60,
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
                          {durationRecalculatingIndex === i && (
                            <span style={{ fontSize: 16, fontWeight: 500, color: "#185FA5", marginLeft: 8 }}>
                              Recalculating…
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                });
              })()}
            </div>

            <div style={{ marginBottom: 12 }}>
              <label
                style={{
                  fontSize: 13,
                  color: "#666",
                  display: "block",
                  marginBottom: 4,
                }}
              >
                Would you like to CC yourself?
              </label>
              {ccEmails.map((email, idx) => (
                <div key={idx} style={{ marginBottom: 6 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => updateCcEmail(idx, e.target.value)}
                      placeholder="your@email.com"
                      style={{ width: 240 }}
                    />
                    {ccEmails.length > 1 && (
                      <button
                        onClick={() => removeCcEmailField(idx)}
                        style={{
                          color: "#d85a30",
                          fontSize: 12,
                          border: "none",
                          background: "none",
                          cursor: "pointer",
                        }}
                      >
                        Remove
                      </button>
                    )}
                  </div>
                  {email && !isValidEmail(email) && (
                    <div style={{ color: "#d85a30", fontSize: 12, marginTop: 2 }}>
                      This doesn&apos;t look like a valid email address
                    </div>
                  )}
                </div>
              ))}
              <button
                onClick={addCcEmailField}
                style={{
                  fontSize: 13,
                  border: "1px solid #999",
                  borderRadius: 4,
                  padding: "4px 10px",
                  background: "#fff",
                  cursor: "pointer",
                }}
              >
                + Add email
              </button>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setStep("plan")}
                className="border border-gray-300 px-4 py-2 rounded"
              >
                Back
              </button>
              <button
                onClick={() => {
                  void downloadScheduleButtonState
                    .run(handleDownloadSchedule)
                    .catch(() => {});
                }}
                disabled={downloadScheduleButtonState.state === "loading"}
                className="border border-gray-300 px-4 py-2 rounded"
                style={{
                  opacity:
                    downloadScheduleButtonState.state === "loading" ? 0.6 : 1,
                  borderColor:
                    downloadScheduleButtonState.state === "success"
                      ? "var(--border-success, #0f6e56)"
                      : undefined,
                  color:
                    downloadScheduleButtonState.state === "success"
                      ? "var(--text-success, #0f6e56)"
                      : undefined,
                }}
              >
                {downloadScheduleButtonState.state === "loading"
                  ? "Preparing..."
                  : downloadScheduleButtonState.state === "success"
                    ? "✓ Downloaded"
                    : "Download schedule"}
              </button>
              <input
                type="email"
                value={scheduleEmailAddress}
                onChange={(e) => setScheduleEmailAddress(e.target.value)}
                placeholder="email@example.com"
                style={{
                  marginLeft: 8,
                  padding: "6px 8px",
                  border: "1px solid #999",
                  borderRadius: 4,
                  background: "#fff",
                  color: "#000",
                  fontSize: 13,
                }}
              />
              <button
                onClick={() => {
                  void emailScheduleButtonState
                    .run(handleEmailSchedule)
                    .catch(() => {});
                }}
                disabled={
                  scheduleEmailSending ||
                  emailScheduleButtonState.state === "loading"
                }
                style={{
                  marginLeft: 4,
                  opacity: emailScheduleButtonState.state === "loading" ? 0.6 : 1,
                  borderColor:
                    emailScheduleButtonState.state === "success"
                      ? "var(--border-success, #0f6e56)"
                      : undefined,
                  color:
                    emailScheduleButtonState.state === "success"
                      ? "var(--text-success, #0f6e56)"
                      : undefined,
                }}
              >
                {emailScheduleButtonState.state === "loading"
                  ? "Sending..."
                  : emailScheduleButtonState.state === "success"
                    ? "✓ Sent"
                    : "Email schedule"}
              </button>
              {scheduleEmailResult && (
                <span
                  style={{
                    marginLeft: 8,
                    fontSize: 12,
                    color: scheduleEmailResult.startsWith("Sent")
                      ? "#0f6e56"
                      : "#a32d2d",
                  }}
                >
                  {scheduleEmailResult}
                </span>
              )}
              <button
                onClick={handleApproveRouteClick}
                disabled={emailSending}
                className="bg-black text-white px-4 py-2 rounded disabled:opacity-30"
              >
                {emailSending ? "Sending emails..." : "Approve route"}
              </button>
            </div>
            {showEmailConfirmation && (
              <div
                style={{
                  background: "#f7f7f7",
                  border: "1px solid #ddd",
                  borderRadius: 12,
                  padding: 20,
                  marginTop: 16,
                }}
              >
                <p style={{ fontWeight: 500, fontSize: 15, margin: "0 0 4px" }}>
                  Ready to send{" "}
                  {
                    routeResult.stops.filter(
                      (stop: any) =>
                        stop.recipientEmails && stop.recipientEmails.length > 0
                    ).length
                  }{" "}
                  viewing
                  request
                  {routeResult.stops.filter(
                    (stop: any) =>
                      stop.recipientEmails && stop.recipientEmails.length > 0
                  ).length === 1
                    ? ""
                    : "s"}
                </p>
                <div style={{ marginBottom: 16 }}>
                  <label
                    style={{
                      fontSize: 12,
                      color: "#666",
                      display: "block",
                      marginBottom: 4,
                    }}
                  >
                    Subject
                  </label>
                  <input
                    type="text"
                    value={emailSubject}
                    onChange={(e) => setEmailSubject(e.target.value)}
                    style={{
                      width: "100%",
                      marginBottom: 10,
                      padding: "6px 8px",
                      border: "1px solid #999",
                      borderRadius: 4,
                      background: "#fff",
                      color: "#000",
                    }}
                  />
                  <label
                    style={{
                      fontSize: 12,
                      color: "#666",
                      display: "block",
                      marginBottom: 4,
                    }}
                  >
                    Message
                  </label>
                  <textarea
                    value={emailBody}
                    onChange={(e) => setEmailBody(e.target.value)}
                    rows={7}
                    style={{
                      width: "100%",
                      fontFamily: "inherit",
                      fontSize: 13,
                      padding: 8,
                      border: "1px solid #999",
                      borderRadius: 4,
                      background: "#fff",
                      color: "#000",
                    }}
                  />
                  <p style={{ fontSize: 11, color: "#999", margin: "6px 0 0" }}>
                    Placeholders like {"{name}"}, {"{address}"}, {"{date}"}, and{" "}
                    {"{time}"} fill in automatically per recipient
                  </p>
                </div>
                <p style={{ fontSize: 13, color: "#666", margin: "0 0 14px" }}>
                  Review the recipients below before sending.
                </p>

                {routeResult.stops.map(
                  (stop: any, idx: number) =>
                    stop.recipientEmails?.length > 0 && (
                      <div
                        key={idx}
                        style={{
                          borderTop: "1px solid #e5e5e5",
                          padding: "10px 0",
                        }}
                      >
                        <p style={{ fontSize: 13, margin: "0 0 2px" }}>
                          {stop.address}
                        </p>
                        <p style={{ fontSize: 12, color: "#666", margin: 0 }}>
                          {stop.recipientEmails.join(", ")}
                        </p>
                      </div>
                    )
                )}

                {filledCcEmails.length > 0 && (
                  <div
                    style={{
                      borderTop: "1px solid #e5e5e5",
                      padding: "10px 0 4px",
                    }}
                  >
                    <p style={{ fontSize: 12, color: "#666", margin: 0 }}>
                      CC: {filledCcEmails.join(", ")}
                    </p>
                  </div>
                )}

                <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
                  <button
                    onClick={() => {
                      void confirmSendButtonState
                        .run(handleConfirmSend)
                        .catch(() => {});
                    }}
                    disabled={confirmSendButtonState.state === "loading"}
                    style={{
                      background: "#000",
                      color:
                        confirmSendButtonState.state === "success"
                          ? "var(--text-success, #0f6e56)"
                          : "#fff",
                      border: "none",
                      padding: "8px 16px",
                      borderRadius: 4,
                      opacity:
                        confirmSendButtonState.state === "loading" ? 0.6 : 1,
                      borderColor:
                        confirmSendButtonState.state === "success"
                          ? "var(--border-success, #0f6e56)"
                          : undefined,
                    }}
                  >
                    {confirmSendButtonState.state === "loading"
                      ? "Sending..."
                      : confirmSendButtonState.state === "success"
                        ? "✓ Sent"
                        : "Confirm and send"}
                  </button>
                  <button
                    onClick={handleCancelSend}
                    style={{ padding: "8px 16px", borderRadius: 4 }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
            {emailResults && (
              <div style={{ marginTop: 16 }}>
                <p style={{ fontWeight: 500, marginBottom: 8 }}>Email status</p>
                {emailResults.map((r: any, idx: number) => (
                  <div key={idx} style={{ fontSize: 13, marginBottom: 4 }}>
                    <span
                      style={{
                        color:
                          r.status === "sent"
                            ? "#0f6e56"
                            : r.status === "skipped"
                              ? "#854f0b"
                              : "#a32d2d",
                      }}
                    >
                      {r.status.toUpperCase()}
                    </span>
                    {" - "}
                    {r.address}
                    {r.sentTo ? ` - sent to ${r.sentTo}` : ""}
                    {r.reason ? ` (${r.reason})` : ""}
                  </div>
                ))}
              </div>
            )}
          </div>
      )}
    </main>
  );
}
