// File storage for videos and frames. Local disk in development, Cloudflare R2 in production
// (STORAGE=r2 with R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET).
import { DeleteObjectsCommand, GetObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

export interface Storage {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  putFile(key: string, path: string, contentType: string): Promise<void>;
  get(key: string): Promise<Readable | null>;
  download(key: string, path: string): Promise<void>;
  removePrefix(prefix: string): Promise<void>;
}

class LocalStorage implements Storage {
  constructor(private root: string) {}
  private path(key: string) {
    if (key.includes("..")) throw new Error("Bad storage key");
    return join(this.root, key);
  }
  async put(key: string, body: Buffer) {
    const p = this.path(key);
    mkdirSync(dirname(p), { recursive: true });
    await pipeline(Readable.from(body), createWriteStream(p));
  }
  async putFile(key: string, path: string) {
    await this.put(key, readFileSync(path));
  }
  async get(key: string) {
    const p = this.path(key);
    return existsSync(p) ? createReadStream(p) : null;
  }
  async download(key: string, path: string) {
    const src = await this.get(key);
    if (!src) throw new Error(`Missing ${key}`);
    mkdirSync(dirname(path), { recursive: true });
    await pipeline(src, createWriteStream(path));
  }
  async removePrefix(prefix: string) {
    rmSync(this.path(prefix), { recursive: true, force: true });
  }
}

class R2Storage implements Storage {
  async removePrefix(prefix: string) {
    for (;;) {
      const list = await this.s3.send(new ListObjectsV2Command({ Bucket: this.bucket, Prefix: prefix, MaxKeys: 1000 }));
      const objects = (list.Contents ?? []).map((o) => ({ Key: o.Key! }));
      if (!objects.length) return;
      await this.s3.send(new DeleteObjectsCommand({ Bucket: this.bucket, Delete: { Objects: objects } }));
      if (!list.IsTruncated) return;
    }
  }
  private s3: S3Client;
  constructor(private bucket: string) {
    this.s3 = new S3Client({
      region: "auto",
      endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID!, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY! },
    });
  }
  async put(key: string, body: Buffer, contentType: string) {
    await this.s3.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }));
  }
  async putFile(key: string, path: string, contentType: string) {
    await this.put(key, readFileSync(path), contentType);
  }
  async get(key: string) {
    try {
      const out = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      return out.Body as Readable;
    } catch (err: any) {
      if (err?.name === "NoSuchKey") return null;
      throw err;
    }
  }
  async download(key: string, path: string) {
    const src = await this.get(key);
    if (!src) throw new Error(`Missing ${key}`);
    mkdirSync(dirname(path), { recursive: true });
    await pipeline(src, createWriteStream(path));
  }
}

export const storage: Storage =
  process.env.STORAGE === "r2" ? new R2Storage(process.env.R2_BUCKET!) : new LocalStorage(process.env.LOCAL_STORAGE_DIR ?? "media/private");

export type Scan3dFile = "scan.json" | "points.ply" | "depth.bin" | "surfels.bin" | "mesh.bin";

export const keys = {
  scanPrefix: (scanId: string) => `scans/${scanId}`,
  input: (scanId: string, ext: string) => `scans/${scanId}/input.${ext}`,
  analysis: (scanId: string) => `scans/${scanId}/analysis.mp4`,
  // The iPhone app's camera tracking for the take (docs/capture-contract.md).
  capture: (scanId: string) => `scans/${scanId}/capture.json`,
  frame: (scanId: string, n: number) => `scans/${scanId}/frames/${String(n).padStart(4, "0")}.jpg`,
  // A photo take's rooms, in place of a video (server/photoInput.ts): its photos are already the frames.
  photos: (scanId: string) => `scans/${scanId}/photos.json`,
  concept: (scanId: string, n: number) => `scans/${scanId}/concepts/${n}.jpg`,
  // The first room keeps the original path, so scans from before rooms still open.
  scan3d: (scanId: string, file: Scan3dFile, room = 0) =>
    room > 0 ? `scans/${scanId}/3d/room-${room}/${file}` : `scans/${scanId}/3d/${file}`,
  // The whole basement put together from its rooms: surface points, the solid surface and where the camera stood.
  basement3d: (scanId: string, file: "surfels.bin" | "mesh.bin" | "scan.json") => `scans/${scanId}/3d/basement/${file}`,
  // Each area as it's measured, for the wait screen (areas are renumbered into rooms afterwards).
  area3d: (scanId: string, area: number, file: "surfels.bin" | "mesh.bin" | "scan.json") => `scans/${scanId}/3d/areas/${area}/${file}`,
};
