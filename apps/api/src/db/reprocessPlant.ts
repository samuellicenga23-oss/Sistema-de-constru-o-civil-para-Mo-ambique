import { readFile } from "node:fs/promises";
import { desc, eq } from "drizzle-orm";
import { db } from "./index.js";
import { extractedRooms, plants } from "./schema.js";
import { processPlantFile } from "../routes/plants.js";

async function main() {
  const plantReference = process.argv[2];
  if (!plantReference) throw new Error("Uso: node dist/db/reprocessPlant.js <plant-id-ou-nome-do-ficheiro>");

  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(plantReference);
  const [plant] = await db
    .select()
    .from(plants)
    .where(isUuid ? eq(plants.id, plantReference) : eq(plants.originalFileName, plantReference))
    .orderBy(desc(plants.uploadedAt))
    .limit(1);
  if (!plant) throw new Error(`Planta não encontrada: ${plantReference}`);

  await db
    .update(plants)
    .set({
      processingStatus: "processando",
      processingProgress: 5,
      processingStage: "A reiniciar a análise",
      processingCurrentPage: null,
      processingTotalPages: null,
      processingStartedAt: new Date(),
      processingUpdatedAt: new Date(),
      errorMessage: null,
    })
    .where(eq(plants.id, plant.id));

  try {
    const buffer = await readFile(plant.filePath);
    await processPlantFile(plant.id, buffer, plant.originalFileName ?? "planta.pdf");
    const rooms = await db.select({ areaM2: extractedRooms.areaM2, floor: extractedRooms.floor })
      .from(extractedRooms)
      .where(eq(extractedRooms.plantId, plant.id));
    const [processedPlant] = await db.select({ documentAnalysis: plants.documentAnalysis })
      .from(plants)
      .where(eq(plants.id, plant.id))
      .limit(1);
    const totalArea = rooms.reduce((sum, room) => sum + Number(room.areaM2), 0);
    const floors = [...new Set(rooms.map((room) => room.floor).filter(Boolean))];
    const sections = processedPlant?.documentAnalysis?.sections
      .map((section) => `${section.label} ${section.startPage}–${section.endPage}`)
      .join("; ");
    console.log(
      `Planta ${plant.id} reprocessada: ${rooms.length} compartimento(s), ${totalArea.toFixed(2)} m², pisos: ${floors.join(", ") || "não atribuídos"}${sections ? `; secções: ${sections}` : ""}.`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro desconhecido";
    await db
      .update(plants)
      .set({
        processingStatus: "erro",
        processingStage: "Análise interrompida",
        processingUpdatedAt: new Date(),
        errorMessage: message,
      })
      .where(eq(plants.id, plant.id));
    throw error;
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
