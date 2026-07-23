import {
  GoogleGenerativeAI,
  SchemaType,
  type Schema,
} from "@google/generative-ai";
import { NextRequest, NextResponse } from "next/server";

function hasCompleteUKPostcode(address: string | null): boolean {
  if (!address) return false;
  const fullPostcodeRegex = /[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}/i;
  return fullPostcodeRegex.test(address);
}

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

const schema: Schema = {
  type: SchemaType.OBJECT,
  properties: {
    address: { type: SchemaType.STRING, nullable: true },
    agencies: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          agencyName: { type: SchemaType.STRING, nullable: true },
          contacts: {
            type: SchemaType.ARRAY,
            items: {
              type: SchemaType.OBJECT,
              properties: {
                name: { type: SchemaType.STRING, nullable: true },
                email: { type: SchemaType.STRING, nullable: true },
                phone: { type: SchemaType.STRING, nullable: true },
              },
              required: ["name", "email", "phone"],
            },
          },
        },
        required: ["agencyName", "contacts"],
      },
    },
  },
  required: ["address", "agencies"],
};

    const model = genAI.getGenerativeModel({
      model: "gemini-3.1-flash-lite",
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: schema,
        temperature: 0,
      },
    });

const BATCH_SIZE = 2;
const DELAY_BETWEEN_BATCHES_MS = 8000;
const MAX_RETRIES = 5;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function extractOne(file: File, attempt = 1): Promise<any> {
  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const base64 = buffer.toString("base64");

    const result = await model.generateContent([
      { inlineData: { mimeType: "application/pdf", data: base64 } },
      {
        text: "Extract the property address and details of every agency marketing this property, including joint/co-agency listings where two or more separate companies are involved. For each agency, extract its name and every individual contact person listed for that agency (name, email, phone). The address MUST include the full UK postcode (e.g. EC4N 8AD, not just EC4) if it appears anywhere in the document - check headers, footers, small print, and contact sections carefully. If a complete postcode genuinely cannot be found, return whatever partial postcode is available. If a field genuinely isn't present, return null for it - do not guess or invent values.",
      },
    ]);

    const rawText = result.response.text();
    const parsed = JSON.parse(rawText);
    console.log(
      `Extracted ${file.name}: address=${parsed.address ? "found" : "missing"}, agencies=${parsed.agencies?.length ?? 0}`
    );

    const hasAnyValidEmail = (parsed.agencies || []).some((agency: any) =>
      (agency.contacts || []).some((contact: any) => contact.email)
    );

    return {
      sourcePdfName: file.name,
      address: parsed.address,
      agencies: parsed.agencies || [],
      needsReview:
        !parsed.address ||
        !hasAnyValidEmail ||
        !hasCompleteUKPostcode(parsed.address),
      error: null,
    };
  } catch (err: any) {
    console.error(`Extraction error for ${file.name}:`, err);
    const isRetryable =
      err?.status === 429 ||
      err?.status === 503 ||
      err?.message?.includes("429") ||
      err?.message?.includes("503") ||
      err?.message?.includes("overloaded") ||
      err?.message?.includes("high demand");

    if (isRetryable && attempt <= MAX_RETRIES) {
      const backoff = 10000 * attempt;
      await sleep(backoff);
      return extractOne(file, attempt + 1);
    }

    return {
      sourcePdfName: file.name,
      address: null,
      agencies: [],
      needsReview: true,
      error: isRetryable
        ? "Gemini's servers are temporarily overloaded or rate-limited — try again in a minute, or enter manually."
        : "Extraction failed — enter details manually.",
    };
  }
}

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const files = formData.getAll("files") as File[];

  const results: any[] = [];

  for (let i = 0; i < files.length; i += BATCH_SIZE) {
    const batch = files.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.all(batch.map((f) => extractOne(f)));
    results.push(...batchResults);

    if (i + BATCH_SIZE < files.length) {
      await sleep(DELAY_BETWEEN_BATCHES_MS);
    }
  }

  return NextResponse.json({ results });
}