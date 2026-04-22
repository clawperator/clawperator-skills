const test = require("node:test");
const assert = require("node:assert/strict");
const { mkdtemp, rm, writeFile } = require("node:fs/promises");
const { join } = require("node:path");
const { tmpdir } = require("node:os");
const zlib = require("node:zlib");

const { readPngRgba } = require("./airtouch5_snapshot.js");

function buildChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const chunkType = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  return Buffer.concat([length, chunkType, data, crc]);
}

function buildRgbaPng(rawScanlines, { width = 1, height = 1 } = {}) {
  const signature = Buffer.from("89504e470d0a1a0a", "hex");
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    signature,
    buildChunk("IHDR", ihdr),
    buildChunk("IDAT", zlib.deflateSync(rawScanlines)),
    buildChunk("IEND", Buffer.alloc(0)),
  ]);
}

test("readPngRgba decodes a minimal RGBA png", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "airtouch5-snapshot-"));
  const pngPath = join(tempDir, "valid.png");

  try {
    await writeFile(pngPath, buildRgbaPng(Buffer.from([0, 10, 20, 30, 255])));
    const image = await readPngRgba(pngPath);

    assert.strictEqual(image.width, 1);
    assert.strictEqual(image.height, 1);
    assert.deepStrictEqual([...image.rgba], [10, 20, 30, 255]);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("readPngRgba rejects truncated scanline data", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "airtouch5-snapshot-"));
  const pngPath = join(tempDir, "truncated.png");

  try {
    await writeFile(pngPath, buildRgbaPng(Buffer.from([0, 10, 20, 30])));
    await assert.rejects(
      readPngRgba(pngPath),
      /png scanline 0 truncated/,
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
