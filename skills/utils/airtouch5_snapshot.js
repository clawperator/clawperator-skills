const { readFile } = require("node:fs/promises");
const zlib = require("node:zlib");

function decodeEntities(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function parseBounds(raw) {
  const match = /^\[(\d+),(\d+)\]\[(\d+),(\d+)\]$/.exec(String(raw || ""));
  if (!match) {
    return null;
  }
  return {
    left: Number.parseInt(match[1], 10),
    top: Number.parseInt(match[2], 10),
    right: Number.parseInt(match[3], 10),
    bottom: Number.parseInt(match[4], 10),
  };
}

function boundsKey(bounds) {
  return `${bounds.left},${bounds.top},${bounds.right},${bounds.bottom}`;
}

function boundsWidth(bounds) {
  return Math.max(0, bounds.right - bounds.left);
}

function boundsHeight(bounds) {
  return Math.max(0, bounds.bottom - bounds.top);
}

function boundsCenter(bounds) {
  return {
    x: Math.round((bounds.left + bounds.right) / 2),
    y: Math.round((bounds.top + bounds.bottom) / 2),
  };
}

function parseXmlNodes(xml) {
  const nodes = [];
  const nodeRegex = /<node\s+([^>]*?)(?:\/>|>)/g;
  let match;
  while ((match = nodeRegex.exec(xml)) !== null) {
    const attributes = {};
    const attrRegex = /([A-Za-z0-9_:-]+)="([^"]*)"/g;
    let attrMatch;
    while ((attrMatch = attrRegex.exec(match[1])) !== null) {
      attributes[attrMatch[1]] = decodeEntities(attrMatch[2]);
    }
    const bounds = parseBounds(attributes.bounds);
    if (!bounds) {
      continue;
    }
    nodes.push({
      text: attributes.text || "",
      resourceId: attributes["resource-id"] || "",
      className: attributes.class || "",
      packageName: attributes.package || "",
      clickable: attributes.clickable === "true",
      focusable: attributes.focusable === "true",
      bounds,
    });
  }
  return nodes;
}

function extractSnapshotXml(rawResult) {
  const xml = rawResult?.envelope?.stepResults?.find((step) => step.actionType === "snapshot_ui")?.data?.text;
  if (typeof xml !== "string" || xml.length === 0) {
    throw new Error("snapshot did not return hierarchy XML");
  }
  return xml;
}

function paethPredictor(a, b, c) {
  const prediction = a + b - c;
  const pa = Math.abs(prediction - a);
  const pb = Math.abs(prediction - b);
  const pc = Math.abs(prediction - c);
  if (pa <= pb && pa <= pc) {
    return a;
  }
  if (pb <= pc) {
    return b;
  }
  return c;
}

async function readPngRgba(path) {
  const data = await readFile(path);
  if (data.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") {
    throw new Error(`not a png: ${path}`);
  }

  let offset = 8;
  let width = 0;
  let height = 0;
  let sawIhdr = false;
  const idatChunks = [];

  while (offset < data.length) {
    const length = data.readUInt32BE(offset);
    offset += 4;
    const type = data.subarray(offset, offset + 4).toString("ascii");
    offset += 4;
    const chunk = data.subarray(offset, offset + length);
    offset += length + 4;

    if (type === "IHDR") {
      if (chunk.length < 13) {
        throw new Error(`png IHDR chunk too short: ${path}`);
      }
      width = chunk.readUInt32BE(0);
      height = chunk.readUInt32BE(4);
      sawIhdr = true;
      const bitDepth = chunk[8];
      const colorType = chunk[9];
      if (bitDepth !== 8 || colorType !== 6) {
        throw new Error(`expected RGBA png, got bitDepth=${bitDepth} colorType=${colorType}`);
      }
    } else if (type === "IDAT") {
      idatChunks.push(chunk);
    } else if (type === "IEND") {
      break;
    }
  }

  if (!sawIhdr || width <= 0 || height <= 0) {
    throw new Error(`png missing valid IHDR dimensions: ${path}`);
  }
  if (idatChunks.length === 0) {
    throw new Error(`png missing IDAT data: ${path}`);
  }

  const raw = zlib.inflateSync(Buffer.concat(idatChunks));
  const stride = width * 4;
  const out = Buffer.alloc(height * stride);
  let inputOffset = 0;
  let previousScanline = Buffer.alloc(stride);

  for (let y = 0; y < height; y += 1) {
    const filter = raw[inputOffset];
    inputOffset += 1;
    const scanline = Buffer.from(raw.subarray(inputOffset, inputOffset + stride));
    inputOffset += stride;

    if (filter === 1) {
      for (let x = 0; x < stride; x += 1) {
        const left = x >= 4 ? scanline[x - 4] : 0;
        scanline[x] = (scanline[x] + left) & 255;
      }
    } else if (filter === 2) {
      for (let x = 0; x < stride; x += 1) {
        scanline[x] = (scanline[x] + previousScanline[x]) & 255;
      }
    } else if (filter === 3) {
      for (let x = 0; x < stride; x += 1) {
        const left = x >= 4 ? scanline[x - 4] : 0;
        const up = previousScanline[x];
        scanline[x] = (scanline[x] + Math.floor((left + up) / 2)) & 255;
      }
    } else if (filter === 4) {
      for (let x = 0; x < stride; x += 1) {
        const left = x >= 4 ? scanline[x - 4] : 0;
        const up = previousScanline[x];
        const upLeft = x >= 4 ? previousScanline[x - 4] : 0;
        scanline[x] = (scanline[x] + paethPredictor(left, up, upLeft)) & 255;
      }
    } else if (filter !== 0) {
      throw new Error(`unsupported png filter ${filter}`);
    }

    scanline.copy(out, y * stride);
    previousScanline = scanline;
  }

  return { width, height, rgba: out };
}

function clampBounds(bounds, width, height) {
  return {
    left: Math.max(0, Math.min(width - 1, bounds.left)),
    top: Math.max(0, Math.min(height - 1, bounds.top)),
    right: Math.max(1, Math.min(width, bounds.right)),
    bottom: Math.max(1, Math.min(height, bounds.bottom)),
  };
}

function averageRgba(image, bounds) {
  const region = clampBounds(bounds, image.width, image.height);
  if (region.left >= region.right || region.top >= region.bottom) {
    throw new Error(`empty screenshot region after clamping: ${JSON.stringify(region)}`);
  }
  let red = 0;
  let green = 0;
  let blue = 0;
  let alpha = 0;
  let count = 0;
  for (let y = region.top; y < region.bottom; y += 1) {
    const rowOffset = y * image.width * 4;
    for (let x = region.left; x < region.right; x += 1) {
      const index = rowOffset + x * 4;
      red += image.rgba[index];
      green += image.rgba[index + 1];
      blue += image.rgba[index + 2];
      alpha += image.rgba[index + 3];
      count += 1;
    }
  }
  if (count === 0) {
    throw new Error(`screenshot region contained no pixels: ${JSON.stringify(region)}`);
  }
  return {
    region,
    pixelCount: count,
    avgRgba: [
      Number((red / count).toFixed(2)),
      Number((green / count).toFixed(2)),
      Number((blue / count).toFixed(2)),
      Number((alpha / count).toFixed(2)),
    ],
  };
}

function classifyPowerState(
  stats,
  {
    brightnessThreshold = 70,
    blueDominanceThreshold = 25,
    greenLiftThreshold = Number.NEGATIVE_INFINITY,
  } = {},
) {
  const [red, green, blue] = stats.avgRgba;
  const brightness = (red + green + blue) / 3;
  const blueDominance = blue - ((red + green) / 2);
  const greenLift = green - red;
  const isOn = brightness > brightnessThreshold
    && blueDominance > blueDominanceThreshold
    && greenLift > greenLiftThreshold;
  return {
    state: isOn ? "on" : "off",
    metrics: {
      brightness: Number(brightness.toFixed(2)),
      blueDominance: Number(blueDominance.toFixed(2)),
      greenLift: Number(greenLift.toFixed(2)),
      avgRgba: stats.avgRgba,
      region: stats.region,
    },
  };
}

module.exports = {
  averageRgba,
  boundsCenter,
  boundsHeight,
  boundsKey,
  boundsWidth,
  classifyPowerState,
  decodeEntities,
  extractSnapshotXml,
  parseBounds,
  parseXmlNodes,
  readPngRgba,
};
