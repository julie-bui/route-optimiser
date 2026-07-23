import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";

const TRAVEL_MODE_LABELS: { [key: string]: string } = {
  publicTransport: "Public transport",
  walking: "Walking",
  cycling: "Cycling",
  car: "Car",
  taxi: "Taxi/rideshare",
};

export async function POST(req: NextRequest) {
  const { stops, travelMode } = await req.json();

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
    const arrival = stop.arrivalTime ? new Date(stop.arrivalTime) : null;
    const timeValue = arrival
      ? new Date(1899, 11, 30, arrival.getHours(), arrival.getMinutes())
      : null;

    const viewingMinutes = stop.viewingMinutes ?? 0;
    const viewingValue = new Date(1899, 11, 30, 0, viewingMinutes);

    const travelMinutes = stop.travelMinutesFromPrevious ?? 0;
    const travelValue =
      i === 0 ? null : new Date(1899, 11, 30, 0, Math.round(travelMinutes));

    const row = sheet.addRow([
      i + 1,
      timeValue,
      stop.address,
      "",
      "",
      viewingValue,
      travelValue,
      TRAVEL_MODE_LABELS[travelMode] || travelMode,
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
