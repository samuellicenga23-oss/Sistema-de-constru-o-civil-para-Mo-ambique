import { readFile } from "node:fs/promises";
import { eq } from "drizzle-orm";
import { db } from "./index.js";
import { extractedRooms, plants } from "./schema.js";
import { processPlantFile } from "../routes/plants.js";

async function main() {
  const plantId = process.argv[2];
  if (!plantId) throw new Error("Uso: node dist/db/reprocessPlant.js <plant-id>");

  const [plant] = await db.select().from(plants).where(eq(plants.id, plantId)).limit(1);
  if (!plant) throw new Error(`Planta não encontrada: ${plantId}`);

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
    .where(eq(plants.id, plantId));

  try {
    const buffer = await readFile(plant.filePath);
    await processPlantFile(plant.id, buffer, plant.originalFileName ?? "planta.pdf");
    const rooms = await db.select({ areaM2: extractedRooms.areaM2, floor: extractedRooms.floor })
      .from(extractedRooms)
      .where(eq(extractedRooms.plantId, plant.id));
    const totalArea = rooms.reduce((sum, room) => sum + Number(room.areaM2), 0);
    const floors = [...new Set(rooms.map((room) => room.floor).filter(Boolean))];
    console.log(
      `Planta ${plant.id} reprocessada: ${rooms.length} compartimento(s), ${totalArea.toFixed(3)} m², pisos: ${floors.join(", ") || "não atribuídos"}.`,
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
      .where(eq(plants.id, plantId));
    throw error;
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
