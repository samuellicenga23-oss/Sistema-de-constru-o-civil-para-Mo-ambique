import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { plantsApi, type ExtractedOpening, type ExtractedRoom, type ExtractedRebarLine, type OpeningInput, type Plant } from "../api/plants";
import { boqApi } from "../api/boq";
import Layout from "../components/Layout";
import { IconBack, IconRefresh, IconRuler, IconTrash } from "../components/icons";
import { buildRebarPurchasePlan } from "@sigo/shared";

const UNASSIGNED_FLOOR = "Piso não identificado";
const SECTION_STYLES = {
  arquitectura: "border-blue-200 bg-blue-50 text-blue-900",
  estrutura: "border-slate-300 bg-slate-50 text-slate-900",
  hidrossanitario: "border-cyan-200 bg-cyan-50 text-cyan-900",
  electricidade: "border-amber-200 bg-amber-50 text-amber-900",
  outro: "border-gray-200 bg-gray-50 text-gray-800",
} as const;

function pageRange(startPage: number, endPage: number) {
  return startPage === endPage ? `Página ${startPage}` : `Páginas ${startPage}–${endPage}`;
}

// Ordena os pisos por senso comum de construção: térreo primeiro, depois pisos numerados a
// subir, depois zonas especiais (anexo, cobertura), e por fim o que não foi identificado.
function floorSortKey(floor: string): number {
  const f = floor.toLowerCase();
  if (f.includes("térreo") || f.includes("terreo") || f.includes("rés")) return 0;
  const numMatch = f.match(/(\d+)/);
  if (numMatch) return parseInt(numMatch[1], 10);
  if (f.includes("superior")) return 50;
  if (f.includes("anexo")) return 80;
  if (f.includes("cobertura")) return 90;
  if (f === UNASSIGNED_FLOOR) return 999;
  return 60;
}

export default function PlantReviewPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [plant, setPlant] = useState<Plant | null>(null);
  const [rooms, setRooms] = useState<ExtractedRoom[]>([]);
  const [openings, setOpenings] = useState<ExtractedOpening[]>([]);
  const [rebarSchedules, setRebarSchedules] = useState<ExtractedRebarLine[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [savingRoomId, setSavingRoomId] = useState<string | null>(null);
  const [reprocessing, setReprocessing] = useState(false);
  const [preparingMeasurements, setPreparingMeasurements] = useState(false);
  const [savingOpeningId, setSavingOpeningId] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    plantsApi
      .detail(id)
      .then(async (detail) => {
        setPlant(detail.plant);
        setRooms(detail.rooms);
        setOpenings(detail.openings);
        setRebarSchedules(detail.rebarSchedules);
      })
      .catch((err) => setError(err.message));
  }, [id]);

  // Reprocessa o ficheiro já guardado com a lógica de extracção mais recente — útil quando o
  // sistema é melhorado depois de a planta já ter sido carregada, sem obrigar o utilizador a
  // encontrar e reenviar o PDF outra vez.
  async function handleReprocess() {
    if (!id) return;
    setReprocessing(true);
    setError(null);
    try {
      const updated = await plantsApi.reprocess(id, (progress) => setPlant((current) => current ? { ...current, ...progress } : current));
      setPlant(updated);
      const detail = await plantsApi.detail(id);
      setRooms(detail.rooms);
      setOpenings(detail.openings);
      setRebarSchedules(detail.rebarSchedules);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao reprocessar a planta");
    } finally {
      setReprocessing(false);
    }
  }

  const floorNames = useMemo(() => {
    const names = new Set(rooms.map((r) => r.floor ?? UNASSIGNED_FLOOR));
    return Array.from(names).sort((a, b) => floorSortKey(a) - floorSortKey(b));
  }, [rooms]);

  const roomsByFloor = useMemo(() => {
    const groups = new Map<string, ExtractedRoom[]>();
    for (const name of floorNames) groups.set(name, []);
    for (const room of rooms) groups.get(room.floor ?? UNASSIGNED_FLOOR)!.push(room);
    return groups;
  }, [rooms, floorNames]);

  async function handleFloorChange(roomId: string, value: string) {
    if (!id) return;
    let newFloor: string | null = value;
    if (value === "__new__") {
      const typed = window.prompt("Nome do novo piso (ex: \"3º Piso\", \"Cave\"):");
      if (!typed || !typed.trim()) return;
      newFloor = typed.trim();
    } else if (value === UNASSIGNED_FLOOR) {
      newFloor = null;
    }
    setSavingRoomId(roomId);
    setError(null);
    try {
      const updated = await plantsApi.updateRoomFloor(id, roomId, newFloor);
      setRooms((rs) => rs.map((r) => (r.id === roomId ? updated : r)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao reatribuir piso");
    } finally {
      setSavingRoomId(null);
    }
  }

  async function handleContinueToMeasurements() {
    if (!plant) return;
    setPreparingMeasurements(true);
    setError(null);
    try {
      const { document } = await boqApi.prepareMeasurementWorkspace(plant.projectId);
      navigate(`/documentos/${document.id}?assistente=1`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível preparar as medições");
    } finally {
      setPreparingMeasurements(false);
    }
  }

  function openingPayload(opening: ExtractedOpening): OpeningInput {
    return {
      kind: opening.kind,
      code: opening.code,
      widthM: opening.widthM ? Number(opening.widthM) : null,
      heightM: opening.heightM ? Number(opening.heightM) : null,
      sillHeightM: opening.sillHeightM ? Number(opening.sillHeightM) : null,
      quantity: opening.quantity,
      floor: opening.floor,
      location: opening.location,
      material: opening.material,
      page: opening.page,
      confirmed: !opening.needsConfirmation,
    };
  }

  async function saveOpening(opening: ExtractedOpening) {
    if (!id) return;
    setSavingOpeningId(opening.id);
    setError(null);
    try {
      const updated = await plantsApi.updateOpening(id, opening.id, { ...openingPayload(opening), confirmed: true });
      setOpenings((items) => items.map((item) => item.id === updated.id ? updated : item));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível guardar o vão");
    } finally {
      setSavingOpeningId(null);
    }
  }

  async function addOpening() {
    if (!id) return;
    setError(null);
    try {
      const created = await plantsApi.createOpening(id, { kind: "janela", widthM: 1.2, heightM: 1.2, quantity: 1, floor: floorNames[0] === UNASSIGNED_FLOOR ? null : floorNames[0] ?? null, location: "exterior", page: 1, confirmed: true });
      setOpenings((items) => [...items, created]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível adicionar o vão");
    }
  }

  async function deleteOpening(openingId: string) {
    if (!id) return;
    await plantsApi.deleteOpening(id, openingId);
    setOpenings((items) => items.filter((item) => item.id !== openingId));
  }

  if (!plant) {
    return <div className="min-h-screen flex items-center justify-center text-gray-400">A carregar...</div>;
  }

  const totalRoomsArea = rooms.reduce((s, r) => s + Number(r.areaM2), 0);
  const totalRebarWeight = rebarSchedules.reduce((s, r) => s + Number(r.weightKg), 0);
  const rebarPurchasePlan = useMemo(
    () => buildRebarPurchasePlan(rebarSchedules.map((line) => ({ diameterMm: Number(line.diameterMm), weightKg: Number(line.weightKg) }))),
    [rebarSchedules],
  );

  // Lacunas de extracção: o utilizador pediu explicitamente para ser informado do que não foi
  // possível puxar automaticamente da planta, sem lhe perguntar como reformatar o ficheiro — por
  // isso listamos factos concretos (o quê não foi encontrado) e nunca pedimos para reenviar nada.
  const gaps: string[] = [];
  const detectedDisciplines = new Set(plant.documentAnalysis?.sections.map((section) => section.discipline));
  const hasArchitecture = detectedDisciplines.size > 0 ? detectedDisciplines.has("arquitectura") : plant.discipline === "arquitectura";
  const hasStructure = detectedDisciplines.size > 0 ? detectedDisciplines.has("estrutura") : plant.discipline === "estrutura";
  if (plant.processingStatus === "erro") {
    gaps.push(
      plant.errorMessage
        ? `Não foi possível processar este ficheiro: ${plant.errorMessage}.`
        : "Não foi possível processar este ficheiro."
    );
  } else {
    if (hasStructure) {
      const s = plant.structuralSummary;
      if (!s) {
        gaps.push(
          "Não foi possível identificar nenhum elemento estrutural (sapatas, pilares ou vigas) nesta planta — o formato deste desenho ainda não é reconhecido pelo sistema."
        );
      } else {
        if (s.footingsCount === 0) gaps.push("Não foram identificadas sapatas/fundações.");
        if (s.columnsCount === 0) gaps.push("Não foram identificados pilares.");
        if (s.beamsCount === 0) gaps.push("Não foram identificadas vigas.");
        if (s.slabsCount === 0) gaps.push("Não foi identificada armadura de laje/cobertura.");
        if (s.totalSteelWeightKg === 0 && rebarSchedules.length === 0 && (s.footingsCount > 0 || s.columnsCount > 0 || s.beamsCount > 0)) {
          gaps.push(
            "Não foi possível determinar o peso total de aço — este desenho não parece incluir resumos de peso por elemento, apenas posições/comprimentos de varões."
          );
        }
      }
    }
    if (hasArchitecture && rooms.length === 0) {
      gaps.push("Não foram identificados compartimentos (áreas) nas páginas de arquitectura.");
    }
    if (hasArchitecture && openings.length === 0) {
      gaps.push("Não foram encontrados quadros ou etiquetas inequívocas de portas e janelas. Registe os vãos manualmente antes de calcular as paredes líquidas.");
    } else if (openings.some((opening) => opening.needsConfirmation || !opening.widthM || !opening.heightM || opening.location === "desconhecida")) {
      gaps.push(`${openings.filter((opening) => opening.needsConfirmation || !opening.widthM || !opening.heightM || opening.location === "desconhecida").length} vão(s) precisam de confirmação de dimensão ou localização.`);
    }
  }

  return (
    <Layout
      title={plant.originalFileName ?? "Planta"}
      actions={
        <div className="flex gap-2">
          <a href={`/api/files/plants/${plant.id}`} target="_blank" rel="noreferrer" className="btn btn-ghost btn-sm">
            Ver PDF original
          </a>
          <button onClick={handleReprocess} disabled={reprocessing} className="btn btn-ghost btn-sm">
            <IconRefresh className="w-3.5 h-3.5" />
            {reprocessing ? `A reprocessar ${plant.processingProgress}%` : "Reprocessar"}
          </button>
          <Link to={`/projectos/${plant.projectId}`} className="btn btn-ghost btn-sm">
            <IconBack className="w-3.5 h-3.5" />
            Voltar ao projecto
          </Link>
        </div>
      }
    >
      <div className="mx-auto w-full max-w-4xl space-y-5">
        {error && <p className="text-sm text-red-600">{error}</p>}

        <section className="card overflow-hidden border-t-4 border-t-brand-600">
          <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-brand-700">Análise concluída</p>
              <h2 className="mt-1 text-lg font-bold text-slate-900">Resumo da planta — confirme só se necessário</h2>
              <p className="mt-1 max-w-2xl text-sm text-slate-600">
                {rooms.length} compartimento(s) · {totalRoomsArea.toFixed(1)} m² · pode medir já ou corrigir pisos abaixo.
              </p>
            </div>
            <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
            <button
              type="button"
              onClick={handleContinueToMeasurements}
              disabled={plant.processingStatus !== "concluido" || preparingMeasurements}
              className="btn btn-primary"
            >
              <IconRuler className="h-4 w-4" />
              {preparingMeasurements ? "A abrir..." : "Medir agora"}
            </button>
            <Link to={`/projectos/${plant.projectId}#plantas-do-projecto`} className="btn btn-secondary">Voltar ao projecto</Link>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-5 py-3 text-xs text-slate-600">
            <span>Tem outra disciplina? Adicione-a antes ou depois; os dados serão combinados automaticamente.</span>
            <Link to={`/projectos/${plant.projectId}#plantas-do-projecto`} className="font-semibold text-brand-700 hover:underline">Adicionar outro projecto →</Link>
          </div>
        </section>

        {plant.documentAnalysis && (
          <details className="card overflow-hidden">
            <summary className="cursor-pointer px-5 py-4 font-semibold text-slate-900">Detalhes da leitura do PDF ({plant.documentAnalysis.pageCount} páginas)</summary>
            <div className="grid gap-3 border-t border-slate-100 p-5 sm:grid-cols-2 lg:grid-cols-3">
              {plant.documentAnalysis.sections.map((section, index) => (
                <div key={`${section.discipline}-${section.startPage}-${index}`} className={`rounded-lg border p-3 ${SECTION_STYLES[section.discipline]}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-bold">{section.label}</p>
                      <p className="mt-0.5 text-xs opacity-75">{pageRange(section.startPage, section.endPage)} · {section.pageCount} página(s)</p>
                      <p className="mt-1 text-[10px] font-semibold uppercase tracking-wide opacity-70">Secção organizada</p>
                    </div>
                    <span className="rounded-full bg-white/70 px-2 py-0.5 text-[10px] font-semibold tabular-nums">{Math.round(section.confidence * 100)}%</span>
                  </div>
                  {section.evidence.length > 0 && <p className="mt-2 text-[11px] leading-relaxed opacity-75">Reconhecido por {section.evidence.slice(0, 2).join(" e ")}.</p>}
                </div>
              ))}
            </div>
          </details>
        )}

        {gaps.length > 0 && (
          <section className="card card-pad border-amber-200 bg-amber-50">
            <div className="flex items-center gap-2 mb-2">
              <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4 text-amber-600 shrink-0">
                <path
                  d="M12 3.5 2 20h20L12 3.5Z M12 9.5v4.5 M12 17h.01"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <h2 className="section-title text-amber-900">O que não foi possível extrair automaticamente</h2>
            </div>
            <ul className="text-sm text-amber-900 space-y-1 list-disc pl-5">
              {gaps.map((g) => (
                <li key={g}>{g}</li>
              ))}
            </ul>
            <p className="text-xs text-amber-700 mt-2">
              Estes pontos podem ser preenchidos à mão no Assistente de Medições ou directamente no Mapa de
              Quantidades — o resto da planta continua a ser usado normalmente.
            </p>
            <button
              type="button"
              onClick={handleContinueToMeasurements}
              disabled={preparingMeasurements}
              className="btn btn-secondary btn-sm mt-3"
            >
              <IconRuler className="h-3.5 w-3.5" />
              {preparingMeasurements ? "A preparar os campos..." : "Indicar dados manualmente"}
            </button>
          </section>
        )}

        {plant.structuralSummary && (
          <section className="card card-pad">
            <div className="flex items-center gap-2 mb-3">
              <IconRuler className="w-4 h-4 text-brand-700" />
              <h2 className="section-title">Resumo estrutural detectado</h2>
            </div>
            <div className="mb-3 grid grid-cols-2 gap-3 text-center sm:grid-cols-3 xl:grid-cols-5">
              <div className="rounded-lg border border-gray-200 p-3">
                <p className="text-xl font-semibold text-gray-900">{plant.structuralSummary.footingsCount}</p>
                <p className="muted">
                  sapatas ·{" "}
                  {((plant.structuralSummary.footingsAvgWidthCm / 100) * (plant.structuralSummary.footingsAvgLengthCm / 100)).toFixed(2)}{" "}
                  m² méd.
                </p>
              </div>
              <div className="rounded-lg border border-gray-200 p-3">
                <p className="text-xl font-semibold text-gray-900">{plant.structuralSummary.columnsCount}</p>
                <p className="muted">pilares</p>
              </div>
              <div className="rounded-lg border border-gray-200 p-3">
                <p className="text-xl font-semibold text-gray-900">{plant.structuralSummary.beamsCount}</p>
                <p className="muted">
                  vigas · {plant.structuralSummary.beamsTotalLengthM.toFixed(1)} ml · {plant.structuralSummary.beamsConcreteVolumeM3.toFixed(2)} m³
                </p>
              </div>
              <div className="rounded-lg border border-gray-200 p-3">
                <p className="text-xl font-semibold text-gray-900">{plant.structuralSummary.slabsCount}</p>
                <p className="muted">laje(s) física(s) por nível</p>
              </div>
              <div className="rounded-lg border border-gray-200 p-3">
                <p className="text-xl font-semibold text-gray-900">{plant.structuralSummary.totalSteelWeightKg.toFixed(0)}</p>
                <p className="muted">kg de aço total</p>
              </div>
            </div>
            {plant.structuralSummary.staircasesCount > 0 && (
              <p className="text-sm text-gray-600 mb-3">
                {plant.structuralSummary.staircasesCount} escada(s) detectada(s) — o aço da(s) escada(s) já está incluído no
                total acima.
              </p>
            )}
            {(plant.structuralSummary.slabs?.length ?? 0) > 0 && (
              <div className="mb-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {plant.structuralSummary.slabs!.map((slab, index) => (
                  <div key={`${slab.floor ?? "laje"}-${slab.thicknessCm}-${index}`} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                    <strong className="block text-sm text-slate-900">{slab.floor ?? `Laje ${index + 1}`}</strong>
                    <span className="text-xs text-slate-500">Espessura {slab.thicknessCm.toFixed(1)} cm · páginas {slab.pages.join(", ")}</span>
                  </div>
                ))}
              </div>
            )}
            <p className="text-xs text-gray-500 mb-3">
              Estes números vêm do quadro de elementos de fundação, do quadro de pilares/vigas, das folhas de armadura
              de laje/cobertura por piso, do detalhe de escadas e do resumo de aço do projecto estrutural. Ao abrir o
              Assistente de Medições num Mapa de Quantidades deste projecto, o nº de sapatas, a área/profundidade
              média, o volume real de betão em vigas (comprimento × secção de cada vão), a espessura real da laje e o
              peso total de aço já vêm preenchidos automaticamente — não precisa de os medir à mão outra vez, e nenhum
              item novo é criado (só os itens-padrão de fundação/estrutura ficam mais precisos). O volume de betão em
              pilares continua a usar uma estimativa genérica — a secção de cada pilar não vem
              como um dado limpo neste tipo de ficheiro (só o desenho da cofragem, sem um valor de largura×altura
              isolado), pelo que não é seguro extraí-la automaticamente.
            </p>
          </section>
        )}

        {rooms.length > 0 && (
          <section className="card card-pad">
            <div className="flex items-center gap-2 mb-3">
              <IconRuler className="w-4 h-4 text-brand-700" />
              <h2 className="section-title">Compartimentos detectados ({rooms.length}) — confirme o piso de cada um</h2>
            </div>
            <p className="text-sm text-gray-600 mb-3">
              Área total: <span className="font-semibold text-gray-900">{totalRoomsArea.toFixed(2)} m²</span>, em{" "}
              {floorNames.length} piso(s) detectado(s). A detecção automática (pelo texto da folha) pode falhar em
              casos ambíguos — reveja e corrija o piso de qualquer compartimento antes de continuar. Cada piso vira um
              piso próprio no Assistente de Medições; nenhum item é criado por compartimento.
            </p>
            <div className="space-y-4">
              {floorNames.map((floorName) => {
                const floorRooms = roomsByFloor.get(floorName) ?? [];
                const floorArea = floorRooms.reduce((s, r) => s + Number(r.areaM2), 0);
                return (
                  <div key={floorName} className="rounded-lg border border-gray-200">
                    <div className="flex items-center justify-between px-3 py-2 bg-gray-50 border-b border-gray-200 rounded-t-lg">
                      <span className="font-medium text-gray-900 text-sm">{floorName}</span>
                      <span className="muted">
                        {floorRooms.length} compartimento(s) · {floorArea.toFixed(2)} m²
                      </span>
                    </div>
                    <table className="w-full text-sm">
                      <tbody>
                        {floorRooms.map((r) => (
                          <tr key={r.id} className="table-row">
                            <td className="py-1.5 pl-3">{r.name}</td>
                            <td className="text-gray-400">{r.number}</td>
                            <td className="text-right tabular-nums">{Number(r.areaM2).toFixed(2)} m²</td>
                            <td className="text-right pr-3 w-48">
                              <select
                                value={r.floor ?? UNASSIGNED_FLOOR}
                                disabled={savingRoomId === r.id}
                                onChange={(e) => handleFloorChange(r.id, e.target.value)}
                                className="input input-sm"
                              >
                                {floorNames.map((f) => (
                                  <option key={f} value={f}>
                                    {f}
                                  </option>
                                ))}
                                <option value="__new__">+ Novo piso...</option>
                              </select>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {hasArchitecture && (
          <section className="card card-pad">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <div><h2 className="section-title">Portas e janelas ({openings.length})</h2><p className="mt-1 text-xs text-slate-500">Confirme dimensão e parede. Só os vãos confirmados entram no cálculo líquido.</p></div>
              <button type="button" className="btn btn-secondary btn-sm" onClick={addOpening}>Adicionar vão</button>
            </div>
            {openings.length === 0 ? <p className="rounded-lg bg-amber-50 px-3 py-3 text-sm text-amber-900">Nenhum vão seguro foi detectado. Adicione portas e janelas manualmente.</p> : (
              <div className="space-y-2">
                {openings.map((opening) => (
                  <div key={opening.id} className={`grid gap-2 rounded-lg border p-3 md:grid-cols-2 xl:grid-cols-[84px_86px_86px_68px_100px_110px_125px_minmax(120px,1fr)_auto] xl:items-end ${opening.needsConfirmation ? "border-amber-200 bg-amber-50/50" : "border-slate-200 bg-white"}`}>
                    <div><label className="label">Tipo</label><select className="input input-sm" value={opening.kind} onChange={(event) => setOpenings((items) => items.map((item) => item.id === opening.id ? { ...item, kind: event.target.value as ExtractedOpening["kind"], needsConfirmation: true } : item))}><option value="porta">Porta</option><option value="janela">Janela</option></select></div>
                    <div><label className="label">Largura</label><input className="input input-sm" type="number" step="0.01" min="0" value={opening.widthM ?? ""} onChange={(event) => setOpenings((items) => items.map((item) => item.id === opening.id ? { ...item, widthM: event.target.value || null, needsConfirmation: true } : item))} /></div>
                    <div><label className="label">Altura</label><input className="input input-sm" type="number" step="0.01" min="0" value={opening.heightM ?? ""} onChange={(event) => setOpenings((items) => items.map((item) => item.id === opening.id ? { ...item, heightM: event.target.value || null, needsConfirmation: true } : item))} /></div>
                    <div><label className="label">Qtd.</label><input className="input input-sm" type="number" step="1" min="1" value={opening.quantity} onChange={(event) => setOpenings((items) => items.map((item) => item.id === opening.id ? { ...item, quantity: Math.max(1, Number(event.target.value)), needsConfirmation: true } : item))} /></div>
                    <div><label className="label">Código</label><input className="input input-sm" value={opening.code ?? ""} placeholder="J01" onChange={(event) => setOpenings((items) => items.map((item) => item.id === opening.id ? { ...item, code: event.target.value || null, needsConfirmation: true } : item))} /></div>
                    <div><label className="label">Piso</label><input className="input input-sm" value={opening.floor ?? ""} placeholder="Piso térreo" onChange={(event) => setOpenings((items) => items.map((item) => item.id === opening.id ? { ...item, floor: event.target.value || null, needsConfirmation: true } : item))} /></div>
                    <div><label className="label">Parede</label><select className="input input-sm" value={opening.location} onChange={(event) => setOpenings((items) => items.map((item) => item.id === opening.id ? { ...item, location: event.target.value as ExtractedOpening["location"], needsConfirmation: true } : item))}><option value="desconhecida">Por definir</option><option value="interior">Interior</option><option value="exterior">Exterior</option></select></div>
                    <div><label className="label">Material</label><input className="input input-sm" value={opening.material ?? ""} placeholder="Ex.: alumínio" onChange={(event) => setOpenings((items) => items.map((item) => item.id === opening.id ? { ...item, material: event.target.value || null, needsConfirmation: true } : item))} /></div>
                    <div className="flex gap-1"><button type="button" className="btn btn-primary btn-sm" disabled={savingOpeningId === opening.id || !opening.widthM || !opening.heightM || opening.location === "desconhecida"} onClick={() => saveOpening(opening)}>{savingOpeningId === opening.id ? "A guardar" : opening.needsConfirmation ? "Confirmar" : "Gravar"}</button><button type="button" className="btn-icon h-9 w-9" aria-label="Eliminar vão" onClick={() => deleteOpening(opening.id)}><IconTrash className="h-4 w-4" /></button></div>
                    <p className="md:col-span-2 xl:col-span-9 text-[11px] text-slate-500">Página {opening.page} · {opening.source === "quadro" ? "quadro de vãos" : opening.source === "geometria" ? "geometria da planta" : "manual"} · confiança {Math.round(Number(opening.confidence) * 100)}%</p>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {rebarSchedules.length > 0 && (
          <section className="card card-pad">
            <h2 className="section-title mb-3">Aço estrutural detectado ({rebarSchedules.length} linhas)</h2>
            <p className="text-sm text-gray-600 mb-3">
              Peso total: <span className="font-semibold text-gray-900">{totalRebarWeight.toFixed(2)} kg</span>. Este
              total já está incluído no resumo estrutural acima. A lista de compra abaixo agrupa o mapa por diâmetro
              e converte o peso em varões comerciais de 12 m.
            </p>
            <div className="mb-4 overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full min-w-[660px] text-sm">
                <thead><tr className="table-head-row"><th className="px-3 py-2 text-left">Diâmetro</th><th className="text-right">Peso do mapa</th><th className="text-right">Comprimento</th><th className="text-right">Varões de 12 m</th><th className="pr-3 text-right">Peso de compra</th></tr></thead>
                <tbody>
                  {rebarPurchasePlan.map((line) => (
                    <tr key={line.diameterMm} className="table-row">
                      <td className="px-3 py-2 font-semibold">Ø{line.diameterMm} mm</td>
                      <td className="text-right tabular-nums">{line.scheduledWeightKg.toFixed(2)} kg</td>
                      <td className="text-right tabular-nums">{line.requiredLengthM.toFixed(1)} m</td>
                      <td className="text-right text-base font-bold tabular-nums text-brand-700">{line.barsToBuy}</td>
                      <td className="pr-3 text-right tabular-nums">{line.purchaseWeightKg.toFixed(2)} kg</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="overflow-x-auto max-h-80 overflow-y-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="table-head-row">
                    <th className="text-left py-1.5">Elemento</th>
                    <th className="text-left">Diâmetro</th>
                    <th className="text-right">Peso (kg)</th>
                    <th className="text-right">Página</th>
                  </tr>
                </thead>
                <tbody>
                  {rebarSchedules.map((r) => (
                    <tr key={r.id} className="table-row">
                      <td className="py-1.5">{r.element}</td>
                      <td>Ø{Number(r.diameterMm)}mm</td>
                      <td className="text-right tabular-nums">{Number(r.weightKg).toFixed(2)}</td>
                      <td className="text-right tabular-nums">{r.page}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>
    </Layout>
  );
}
