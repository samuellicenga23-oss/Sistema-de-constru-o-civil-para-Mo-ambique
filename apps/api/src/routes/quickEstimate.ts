import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireRole } from "../auth/middleware.js";
import { assertDocumentOwned } from "../services/accessControl.js";
import { documentLockedMessage } from "../services/documentRules.js";
import { applyQuickEstimate, getStandardSectionId } from "../services/quickEstimate.js";

const WRITE_ROLES = ["admin_empresa", "orcamentista"] as const;

const roomSchema = z.object({
  name: z.string().min(1),
  type: z.enum(["seco", "humido"]),
  length: z.number().positive(),
  width: z.number().positive(),
  perimeterM: z.number().positive().optional(),
});

const floorSchema = z.object({
  label: z.string().min(1).optional(),
  ceilingHeight: z.number().positive(),
  perimeter: z.number().positive(),
  rooms: z.array(roomSchema).min(1),
});

const floorSlabSchema = z.object({
  label: z.string().min(1),
  areaM2: z.number().positive(),
  thicknessM: z.number().positive(),
  topRebar: z.object({
    xDiameterMm: z.number().positive().max(50),
    xSpacingCm: z.number().positive().max(100),
    yDiameterMm: z.number().positive().max(50),
    ySpacingCm: z.number().positive().max(100),
  }).nullable().optional(),
  bottomRebar: z.object({
    xDiameterMm: z.number().positive().max(50),
    xSpacingCm: z.number().positive().max(100),
    yDiameterMm: z.number().positive().max(50),
    ySpacingCm: z.number().positive().max(100),
  }).nullable().optional(),
});

const openingSchema = z.object({
  kind: z.enum(["porta", "janela"]),
  widthM: z.number().positive(),
  heightM: z.number().positive(),
  quantity: z.number().int().positive(),
  location: z.enum(["interior", "exterior", "desconhecida"]),
  confirmed: z.boolean(),
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
  scopes: z.array(z.enum(["preliminares", "terraplenagem", "estrutura", "arquitectura", "drenagem", "cobertura", "hidraulica", "electricidade", "vaos"])).min(1).optional(),
  floors: z.array(floorSchema).optional(),
  foundationType: z.enum(["sapata_isolada", "sapata_corrida", "laje"]).optional(),
  footing: footingSchema.optional(),
  slabThickness: z.number().positive().optional(),
  concreteClass: z.enum(["B20", "B25", "B30"]).optional(),
  roofType: z.enum(["laje_plana", "chapa_metalica"]).optional(),
  roofArea: z.number().positive().optional(),
  steelWeightKg: z.number().positive().optional(),
  beamConcreteVolumeM3: z.number().positive().optional(),
  floorSlabThicknessM: z.number().positive().optional(),
  floorSlabs: z.array(floorSlabSchema).optional(),
  pavementReinforcement: z.enum(["bars_6_20", "welded_mesh", "none"]).optional(),
  foundationMembrane: z.boolean().optional(),
  groundBeam: z.object({
    enabled: z.boolean(),
    lengthM: z.number().positive().optional(),
    longitudinalBars: z.number().int().min(2).max(12).optional(),
    diameterMm: z.number().min(6).max(40).optional(),
  }).optional(),
  openings: z.array(openingSchema).optional(),
  columnConcreteVolumeM3: z.number().positive().optional(),
  formworkAreaM2: z.number().positive().optional(),
  backfillEarthVolumeM3: z.number().positive().optional(),
  sewerPipe110M: z.number().min(0).optional(),
  sewerPipe40M: z.number().min(0).optional(),
  downpipeLengthM: z.number().min(0).optional(),
  waterSupplyPipeM: z.number().min(0).optional(),
  hydraulic: hydraulicSchema.optional(),
  septicTank: septicTankSchema.optional(),
}).superRefine((data, ctx) => {
  const scopes = new Set(data.scopes ?? []);
  const geometryRequired = scopes.has("preliminares") || scopes.has("arquitectura") || scopes.has("electricidade");
  const structureRequired = scopes.has("estrutura") || scopes.has("terraplenagem");
  if (data.scopes) {
    if (geometryRequired && !data.floors?.length) ctx.addIssue({ code: "custom", path: ["floors"], message: "Indique pelo menos um piso para os trabalhos seleccionados." });
    if (structureRequired && !data.foundationType) ctx.addIssue({ code: "custom", path: ["foundationType"], message: "Confirme o tipo de fundação." });
    if (scopes.has("cobertura") && (!data.roofType || !data.roofArea)) ctx.addIssue({ code: "custom", path: ["roofArea"], message: "Confirme o tipo e a área de cobertura." });
    if (scopes.has("vaos") && !data.openings?.some((opening) =>
      opening.confirmed && opening.location !== "desconhecida" && opening.widthM > 0 && opening.heightM > 0,
    )) {
      ctx.addIssue({
        code: "custom",
        path: ["openings"],
        message: "Confirme pelo menos uma porta ou janela com dimensões e parede interior/exterior.",
      });
    }
  } else {
    if (!data.floors?.length) ctx.addIssue({ code: "custom", path: ["floors"], message: "Indique pelo menos um piso." });
    if (!data.foundationType) ctx.addIssue({ code: "custom", path: ["foundationType"], message: "Confirme o tipo de fundação." });
    if (!data.concreteClass || !data.roofType) ctx.addIssue({ code: "custom", path: [], message: "Confirme a estrutura e a cobertura." });
  }
});

export async function quickEstimateRoutes(app: FastifyInstance) {
  app.post("/api/budget-documents/:id/quick-estimate", { preHandler: requireRole(...WRITE_ROLES) }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const companyId = request.currentUser!.companyId!;
    const document = await assertDocumentOwned(id, companyId);
    if (!document) return reply.code(404).send({ error: "Documento não encontrado" });
    if (document.status !== "rascunho") {
      return reply.code(409).send({ error: documentLockedMessage(document.status) });
    }

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
