// Identifica o tipo de imagem pelos bytes reais do ficheiro (assinatura/"magic bytes"), nunca
// pela extensão ou pelo Content-Type que o cliente diz que é — ambos são fáceis de falsificar.
// Sem isto, um upload de logótipo aceitava qualquer extensão (achado da auditoria): um ficheiro
// .svg com <script> embutido, por exemplo, ficava acessível publicamente em /uploads/.
export function detectImageExtension(buffer: Buffer): string | null {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return ".png";
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return ".jpg";
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP") return ".webp";
  if (buffer.length >= 4 && buffer.subarray(0, 4).toString("ascii") === "GIF8") return ".gif";
  return null;
}

/** Mesma lógica, mas também aceita PDF — para comprovativos de pagamento (banco costuma emitir PDF). */
export function detectProofFileExtension(buffer: Buffer): string | null {
  if (buffer.length >= 5 && buffer.subarray(0, 5).toString("ascii") === "%PDF-") return ".pdf";
  return detectImageExtension(buffer);
}
