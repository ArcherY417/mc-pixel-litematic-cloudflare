import { gzipSync } from "fflate";

type Tag =
  | { type: 1; name: string; value: number }
  | { type: 3; name: string; value: number }
  | { type: 4; name: string; value: bigint }
  | { type: 8; name: string; value: string }
  | { type: 9; name: string; listType: number; value: Tag[] }
  | { type: 10; name: string; value: Tag[] }
  | { type: 11; name: string; value: number[] }
  | { type: 12; name: string; value: bigint[] };

const encoder = new TextEncoder();

class Writer {
  private chunks: number[] = [];

  bytes() {
    return new Uint8Array(this.chunks);
  }

  byte(value: number) {
    this.chunks.push(value & 0xff);
  }

  short(value: number) {
    this.chunks.push((value >> 8) & 0xff, value & 0xff);
  }

  int(value: number) {
    this.chunks.push((value >> 24) & 0xff, (value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff);
  }

  long(value: bigint) {
    const unsigned = BigInt.asUintN(64, value);
    this.int(Number((unsigned >> 32n) & 0xffffffffn));
    this.int(Number(unsigned & 0xffffffffn));
  }

  string(value: string) {
    const bytes = encoder.encode(value);
    this.short(bytes.length);
    for (const byte of bytes) this.byte(byte);
  }
}

export function compound(name: string, value: Tag[]): Tag {
  return { type: 10, name, value };
}

export function intTag(name: string, value: number): Tag {
  return { type: 3, name, value };
}

export function longTag(name: string, value: bigint): Tag {
  return { type: 4, name, value };
}

export function stringTag(name: string, value: string): Tag {
  return { type: 8, name, value };
}

export function listTag(name: string, listType: number, value: Tag[]): Tag {
  return { type: 9, name, listType, value };
}

export function intArrayTag(name: string, value: number[]): Tag {
  return { type: 11, name, value };
}

export function longArrayTag(name: string, value: bigint[]): Tag {
  return { type: 12, name, value };
}

export function writeGzippedNbt(root: Tag): Uint8Array {
  const writer = new Writer();
  writeNamedTag(writer, root);
  return gzipSync(writer.bytes());
}

function writeNamedTag(writer: Writer, tag: Tag) {
  writer.byte(tag.type);
  writer.string(tag.name);
  writePayload(writer, tag);
}

function writePayload(writer: Writer, tag: Tag) {
  switch (tag.type) {
    case 1:
      writer.byte(tag.value);
      return;
    case 3:
      writer.int(tag.value);
      return;
    case 4:
      writer.long(tag.value);
      return;
    case 8:
      writer.string(tag.value);
      return;
    case 9:
      writer.byte(tag.listType);
      writer.int(tag.value.length);
      for (const item of tag.value) writePayload(writer, item);
      return;
    case 10:
      for (const child of tag.value) writeNamedTag(writer, child);
      writer.byte(0);
      return;
    case 11:
      writer.int(tag.value.length);
      for (const item of tag.value) writer.int(item);
      return;
    case 12:
      writer.int(tag.value.length);
      for (const item of tag.value) writer.long(item);
      return;
  }
}
