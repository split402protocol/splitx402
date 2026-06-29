export function decodeArtifactText(value: Uint8Array | string): string {
  if (typeof value === "string") {
    return value;
  }
  if (hasBom(value, 0xff, 0xfe)) {
    return new TextDecoder("utf-16le").decode(value);
  }
  if (hasBom(value, 0xfe, 0xff)) {
    return new TextDecoder("utf-16be").decode(value);
  }
  if (hasBom(value, 0xef, 0xbb, 0xbf)) {
    return new TextDecoder("utf-8").decode(value);
  }
  return new TextDecoder().decode(value);
}

function hasBom(value: Uint8Array, ...bytes: number[]): boolean {
  return bytes.every((byte, index) => value[index] === byte);
}
