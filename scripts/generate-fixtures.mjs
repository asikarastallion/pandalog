#!/usr/bin/env node
/**
 * Generates the synthetic ArduPilot DataFlash fixtures under `fixtures/ardupilot/`.
 *
 * Run with: node scripts/generate-fixtures.mjs
 *
 * The `.BIN` files are committed — they are the immutable inputs of the golden tests — and this
 * script is committed alongside them so they are reproducible rather than opaque blobs.
 *
 * IMPORTANT, and stated in `fixtures/ardupilot/README.md` too: these logs are synthetic. They
 * exercise the decoder's structure, not its fidelity to real ArduPilot output. Because this
 * encoder and the decoder in `packages/parser-ardupilot` were written from the same understanding
 * of the format, a golden test built only on them proves self-consistency. What independently
 * pins the decoder is `test/format.test.ts`, whose expected bytes were computed outside this
 * codebase for every format character. Validating against a real flight log remains outstanding.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { stdout } from 'node:process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'fixtures',
  'ardupilot',
);

const HEAD1 = 0xa3;
const HEAD2 = 0x95;
const FMT_TYPE = 0x80;

/** Byte width of each format character; mirrors packages/parser-ardupilot/src/format.ts. */
const WIDTHS = {
  b: 1,
  B: 1,
  M: 1,
  h: 2,
  H: 2,
  c: 2,
  C: 2,
  i: 4,
  I: 4,
  f: 4,
  e: 4,
  E: 4,
  L: 4,
  n: 4,
  d: 8,
  q: 8,
  Q: 8,
  N: 16,
  Z: 64,
  a: 64,
};

const MESSAGES = {
  ATT: { type: 30, format: 'QccccCC', labels: 'TimeUS,DesRoll,Roll,DesPitch,Pitch,DesYaw,Yaw' },
  BARO: { type: 31, format: 'Qffc', labels: 'TimeUS,Alt,Press,Temp' },
  MODE: { type: 32, format: 'QMBB', labels: 'TimeUS,Mode,ModeNum,Rsn' },
  GPS: {
    type: 33,
    format: 'QBIHBcLLeff',
    labels: 'TimeUS,Status,GMS,GWk,NSats,HDop,Lat,Lng,Alt,Spd,VZ',
  },
  ERR: { type: 34, format: 'QBB', labels: 'TimeUS,Subsys,ECode' },
  MSG: { type: 35, format: 'QZ', labels: 'TimeUS,Message' },
  VIBE: { type: 36, format: 'Qfff', labels: 'TimeUS,VibeX,VibeY,VibeZ' },
};

const bodySize = (format) => [...format].reduce((total, char) => total + WIDTHS[char], 0);

function writeString(view, offset, text, width) {
  for (let i = 0; i < width; i += 1) {
    view.setUint8(offset + i, i < text.length ? text.charCodeAt(i) : 0);
  }
}

/** An FMT packet declaring one message type. */
function fmtPacket(name, def) {
  const bytes = new Uint8Array(3 + 86);
  const view = new DataView(bytes.buffer);
  view.setUint8(0, HEAD1);
  view.setUint8(1, HEAD2);
  view.setUint8(2, FMT_TYPE);
  view.setUint8(3, def.type);
  view.setUint8(4, 3 + bodySize(def.format));
  writeString(view, 5, name, 4);
  writeString(view, 9, def.format, 16);
  writeString(view, 25, def.labels, 64);
  return bytes;
}

/** A data packet for a declared message, values in label order. */
function dataPacket(def, values) {
  const bytes = new Uint8Array(3 + bodySize(def.format));
  const view = new DataView(bytes.buffer);
  view.setUint8(0, HEAD1);
  view.setUint8(1, HEAD2);
  view.setUint8(2, def.type);

  let offset = 3;
  [...def.format].forEach((char, index) => {
    const value = values[index];
    switch (char) {
      case 'b':
        view.setInt8(offset, value);
        break;
      case 'B':
      case 'M':
        view.setUint8(offset, value);
        break;
      case 'h':
        view.setInt16(offset, value, true);
        break;
      case 'H':
        view.setUint16(offset, value, true);
        break;
      case 'c':
        view.setInt16(offset, Math.round(value * 100), true);
        break;
      case 'C':
        view.setUint16(offset, Math.round(value * 100), true);
        break;
      case 'i':
        view.setInt32(offset, value, true);
        break;
      case 'I':
        view.setUint32(offset, value, true);
        break;
      case 'e':
        view.setInt32(offset, Math.round(value * 100), true);
        break;
      case 'E':
        view.setUint32(offset, Math.round(value * 100), true);
        break;
      case 'L':
        view.setInt32(offset, Math.round(value * 1e7), true);
        break;
      case 'f':
        view.setFloat32(offset, value, true);
        break;
      case 'd':
        view.setFloat64(offset, value, true);
        break;
      case 'q':
        view.setBigInt64(offset, BigInt(value), true);
        break;
      case 'Q':
        view.setBigUint64(offset, BigInt(value), true);
        break;
      case 'n':
        writeString(view, offset, value, 4);
        break;
      case 'N':
        writeString(view, offset, value, 16);
        break;
      case 'Z':
        writeString(view, offset, value, 64);
        break;
      default:
        throw new Error(`fixture generator cannot encode format char ${char}`);
    }
    offset += WIDTHS[char];
  });

  return bytes;
}

const concat = (chunks) => {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
};

const us = (seconds) => Math.round(seconds * 1e6);

// ---------------------------------------------------------------------------------------------
// Fixture 1 — nominal flight: attitude, baro and GPS over 2 s, one mode change at the start.
// ---------------------------------------------------------------------------------------------
function nominal() {
  const chunks = [
    fmtPacket('ATT', MESSAGES.ATT),
    fmtPacket('BARO', MESSAGES.BARO),
    fmtPacket('GPS', MESSAGES.GPS),
    fmtPacket('MODE', MESSAGES.MODE),
    dataPacket(MESSAGES.MODE, [us(0.0), 5, 5, 1]),
  ];

  for (let i = 0; i < 20; i += 1) {
    const t = i * 0.1;
    const roll = 5 * Math.sin(i / 3);
    const pitch = 3 * Math.cos(i / 4);
    chunks.push(dataPacket(MESSAGES.ATT, [us(t), roll, roll + 0.2, pitch, pitch - 0.1, 90, 90.5]));
    chunks.push(dataPacket(MESSAGES.BARO, [us(t), 12.5 + i * 0.25, 101325 - i * 3, 21.5]));
    if (i % 2 === 0) {
      chunks.push(
        dataPacket(MESSAGES.GPS, [
          us(t),
          3,
          200000 + i,
          2300,
          12,
          0.85,
          39.5 + i * 1e-5,
          32.8 + i * 1e-5,
          850 + i * 0.25,
          4.2,
          -0.3,
        ]),
      );
    }
  }

  return concat(chunks);
}

// ---------------------------------------------------------------------------------------------
// Fixture 2 — GPS glitch and a declared-but-never-logged message type.
//
// VIBE is declared in the format table but no VIBE record is ever written, which is what Phase B's
// acceptance criterion calls a "declared-but-unlogged message type": it must surface as
// Validity.UNSUPPORTED, not MISSING and not a default value.
//
// The GPS run also contains NaN speed samples — a real value the vehicle logs when it has no fix —
// which must arrive as Validity.INVALID with NaN, never as 0.
// ---------------------------------------------------------------------------------------------
function gpsGlitch() {
  const chunks = [
    fmtPacket('ATT', MESSAGES.ATT),
    fmtPacket('GPS', MESSAGES.GPS),
    fmtPacket('VIBE', MESSAGES.VIBE),
  ];

  for (let i = 0; i < 10; i += 1) {
    const t = i * 0.2;
    chunks.push(dataPacket(MESSAGES.ATT, [us(t), 1, 1.1, 0.5, 0.4, 180, 180.2]));

    const lostFix = i >= 4 && i <= 6;
    chunks.push(
      dataPacket(MESSAGES.GPS, [
        us(t),
        lostFix ? 1 : 3,
        200000 + i,
        2300,
        lostFix ? 0 : 11,
        lostFix ? 99.99 : 0.9,
        lostFix ? 0 : 39.5,
        lostFix ? 0 : 32.8,
        lostFix ? 0 : 860,
        lostFix ? NaN : 3.9,
        lostFix ? NaN : -0.1,
      ]),
    );
  }

  return concat(chunks);
}

// ---------------------------------------------------------------------------------------------
// Fixture 3 — in-flight mode change plus a logged error and text message.
// ---------------------------------------------------------------------------------------------
function modeChangeAndError() {
  const chunks = [
    fmtPacket('ATT', MESSAGES.ATT),
    fmtPacket('MODE', MESSAGES.MODE),
    fmtPacket('ERR', MESSAGES.ERR),
    fmtPacket('MSG', MESSAGES.MSG),
    dataPacket(MESSAGES.MSG, [us(0.0), 'ArduCopter V4.5.0 (synthetic fixture)']),
    dataPacket(MESSAGES.MODE, [us(0.1), 0, 0, 1]),
  ];

  for (let i = 0; i < 12; i += 1) {
    chunks.push(dataPacket(MESSAGES.ATT, [us(i * 0.25), 0, 0.1, 0, -0.1, 45, 45.3]));
  }

  chunks.push(dataPacket(MESSAGES.MODE, [us(1.5), 5, 5, 1]));
  chunks.push(dataPacket(MESSAGES.ERR, [us(2.0), 11, 2]));
  chunks.push(dataPacket(MESSAGES.MODE, [us(2.5), 6, 6, 4]));

  return concat(chunks);
}

mkdirSync(OUT_DIR, { recursive: true });
for (const [name, build] of [
  ['nominal.bin', nominal],
  ['gps-glitch.bin', gpsGlitch],
  ['mode-change-error.bin', modeChangeAndError],
]) {
  const bytes = build();
  writeFileSync(path.join(OUT_DIR, name), bytes);
  stdout.write(`${name}: ${String(bytes.length)} bytes\n`);
}
