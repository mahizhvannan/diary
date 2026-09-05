export type ChatImage = { mimeType: string; data: string };

export async function fileToAttachment(file: File): Promise<{
  id: string;
  name: string;
  mimeType: string;
  dataUrl: string;
}> {
  if (file.type.startsWith("image/")) {
    const dataUrl = await compressImage(file);
    return {
      id: crypto.randomUUID(),
      name: file.name,
      mimeType: "image/jpeg",
      dataUrl,
    };
  }
  const dataUrl = await readAsDataUrl(file);
  return {
    id: crypto.randomUUID(),
    name: file.name,
    mimeType: file.type || "application/octet-stream",
    dataUrl,
  };
}

export function dataUrlToImage(dataUrl: string): ChatImage | null {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;
  if (!match[1].startsWith("image/")) return null;
  return { mimeType: match[1], data: match[2] };
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function compressImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const max = 1280;
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        URL.revokeObjectURL(url);
        reject(new Error("canvas"));
        return;
      }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/jpeg", 0.82));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("image"));
    };
    img.src = url;
  });
}
