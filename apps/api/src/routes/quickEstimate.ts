import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireRole } from "../auth/middleware.js";
import { assertDocumentOwned } from "../services/accessControl.js";
import { applyQuickEstimate, getStandardSectionId } from "../services/quickEstimate.js";

const WRITE_ROLES = ["admin_empresa", "orcamentista"] as const;

const roomSchema = z.object({
  name: z.string().min(1),
  type: z.enum(["seco", "humido"]),
  length: z.number().positive(),
  width: z.number().positive(),
});

const floorSchema = z.object({
  ceilingHeight: z.number().positive(),
  perimeter: z.number().positive(),
  rooms: z.array(roomSchema).min(1),
});

const footingSchema = z.object({
  count: z.number().int().positive(),
  avgArea: z.number().positive(),
  avgDepth: z.number().positive(),
});

const hydraulicSchema = z.object({
  toilets: z.number().int().min(0),
  sinks: z.number().int().min(0),
  showers: z.number().int().min(0),
  kitchenSinks: z.number().int().min(0),
  laundryTanks: z.number().int().min(0),
  hasWaterTank: z.boolean(),
  manholeCount: z.number().int().min(0),
});

const septicTankSchema = z.object({
  numberOfPeople: z.number().int().positive(),
  dailyFlowLPerPerson: z.number().positive(),
  soilType: z.enum(["areia_grossa", "areia_fina", "argila_arenosa", "argila_compacta"]),
});

const quickEstimateSchema = z.object({
  floors: z.array(floorSchema).min(1),
  foundationType: z.enum(["sapata_isolada", "sapata_corrida", "laje"]),
  footing: footingSchema.optional(),
  slabThickness: z.number().positive().optional(),
  concreteClass: z.enum(["B20", "B25", "B30"]),
  roofType: z.enum(["laje_plana", "chapa_metalica"]),
  roofArea: z.number().positive().optional(),
  steelWeightKg: z.number().positive().optional(),
  beamConcreteVolumeM3: z.number().positive().optional(),
  floorSlabThicknessM: z.number().positive().optional(),
  columnConcreteVolumeM3: z.number().positive().optional(),
  formworkAreaM2: z.number().positive().optional(),
  backfillEarthVolumeM3: z.number().positive().optional(),
  sewerPipe110M: z.number().min(0).optional(),
  sewerPipe40M: z.number().min(0).optional(),
  downpipeLengthM: z.number().min(0).optional(),
  waterSupplyPipeM: z.number().min(0).optional(),
  hydraulic: hydraulicSchema.optional(),
  septicTank: septicTankSchema.optional(),
});

export async function quickEstimateRoutes(app: FastifyInstance) {
  app.post("/api/budget-documents/:id/quick-estimate", { preHandler: requireRole(...WRITE_ROLES) }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const companyId = request.currentUser!.companyId!;
    const document = await assertDocumentOwned(id, companyId);
    if (!document) return reply.code(404).send({ error: "Documento não encontrado" });

    const parsed = quickEstimateSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

    const sectionId = await getStandardSectionId(id);
    if (!sectionId) {
      return reply.code(409).send({
        error: "Este documento não usa a estrutura automática do SIGO. Volte ao projecto e escolha «Preparar medições» para criar ou abrir um mapa compatível.",
      });
    }

    const result = await applyQuickEstimate(id, sectionId, parsed.data);
    return result;
  });
}
