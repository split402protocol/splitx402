import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export type SettlementStatus = "mock-settled" | "settled" | "settlement-failed";

export interface SettlementRecord {
  paymentId: string;
  route: string;
  method: string;
  amount: string;
  asset: string;
  network: string;
  payer?: string;
  transaction?: string;
  status: SettlementStatus;
  raw: unknown;
  createdAt: string;
}

export class SettlementStore {
  private readonly filePath: string;

  constructor(dataDir: string) {
    this.filePath = path.join(dataDir, "settlements.jsonl");
  }

  async append(record: SettlementRecord): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, `${JSON.stringify(record)}\n`, { flag: "a" });
  }

  async list(): Promise<SettlementRecord[]> {
    try {
      const contents = await readFile(this.filePath, "utf8");
      return contents
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as SettlementRecord);
    } catch (error) {
      if (isMissingFile(error)) {
        return [];
      }

      throw error;
    }
  }

  async findByPaymentId(paymentId: string): Promise<SettlementRecord | null> {
    const records = await this.list();
    return records.find((record) => record.paymentId === paymentId) ?? null;
  }
}

function isMissingFile(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

