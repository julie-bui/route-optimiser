import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { keepOnlyMobileNumber } from "@/app/lib/phoneFilter";
import {
  roundUpMinutesToFive,
  roundUpToFiveMinutes,
} from "../../lib/timeFormat";

function describeLegs(legs: any[] | undefined): string {
  if (!legs || legs.length === 0) return "";

  return legs
    .map((leg) => {
      if (leg.mode === "walking") return "Walk";
      if (leg.mode === "bus") return `Bus ${leg.lineName || ""}`.trim();
      if (leg.mode === "tube") return `Tube (${leg.lineName || ""})`.trim();
      if (leg.mode === "national-rail") {
        return `Train (${leg.lineName || ""})`.trim();
      }
      if (leg.mode === "cycle") return "Cycle";
      if (leg.mode === "car") return "Car";
      if (leg.mode === "taxi") return "Taxi";
      return leg.mode;
    })
    .join(", ");
}

export async function POST(req: NextRequest) {
  const { stops } = await req.json();

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Tour");

  const headers = [
    "",
    "Time",
    "Address",
    "Site Contact",
    "Number",
    "Viewing time",
    "Travel time",
    "Travel Mode",
  ];
  const headerRow = sheet.addRow(headers);
  headerRow.eachCell((cell) => {
    cell.font = { name: "Calibri", size: 11, bold: true };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFD9D9D9" },
    };
  });

  stops.forEach((stop: any, i: number) => {
    const arrival = stop.arrivalTime
      ? roundUpToFiveMinutes(new Date(stop.arrivalTime))
      : null;
    const timeValue = arrival
      ? new Date(1899, 11, 30, arrival.getHours(), arrival.getMinutes())
      : null;

    const viewingMinutes = stop.viewingMinutes ?? 0;
    const viewingValue = new Date(1899, 11, 30, 0, viewingMinutes);

    const travelMinutes = stop.travelMinutesFromPrevious ?? 0;
    // A property start's first stop has no incoming leg (travelMinutesFromPrevious
    // is 0). An external (office/custom) start's first stop has a real one that
    // must not be silently dropped just because it happens to be row 0.
    const hasIncomingTravel = i > 0 || Boolean(stop.travelMinutesFromPrevious);
    const travelValue = hasIncomingTravel
      ? new Date(1899, 11, 30, 0, roundUpMinutesToFive(travelMinutes))
      : null;

    console.log(`DEBUG stop "${stop.address}" recipients (${(stop.recipients || []).length}):`, JSON.stringify(stop.recipients));

    const agentNames = (stop.recipients || [])
      .map((r: any) => r.name)
      .filter(Boolean)
      .join(", ");
    const agentPhones = (stop.recipients || [])
      .map((r: any) => keepOnlyMobileNumber(r.phone))
      .filter(Boolean)
      .join(", ");

    const row = sheet.addRow([
      i + 1,
      timeValue,
      stop.address,
      agentNames,
      agentPhones,
      viewingValue,
      travelValue,
      hasIncomingTravel ? describeLegs(stop.legs) : "",
    ]);

    row.getCell(2).numFmt = "h:mm:ss";
    row.getCell(6).numFmt = "h:mm:ss";
    if (travelValue) row.getCell(7).numFmt = "h:mm:ss";

    row.font = { name: "Calibri", size: 11 };
  });

  sheet.columns = [
    { width: 4 },
    { width: 10 },
    { width: 32 },
    { width: 18 },
    { width: 15 },
    { width: 14 },
    { width: 13 },
    { width: 18 },
  ];

  const buffer = await workbook.xlsx.writeBuffer();

  return new NextResponse(buffer, {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": "attachment; filename=\"tour-schedule.xlsx\"",
    },
  });
}
