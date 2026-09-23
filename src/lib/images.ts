export function imageExtension(b: Buffer): string {
  if (b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
    return "png";
  if (b[0] === 255 && b[1] === 216 && b[2] === 255) return "jpg";
  if (
    b.toString("ascii", 0, 4) === "RIFF" &&
    b.toString("ascii", 8, 12) === "WEBP"
  )
    return "webp";
  if (["GIF87a", "GIF89a"].includes(b.toString("ascii", 0, 6))) return "gif";
  return "";
}
