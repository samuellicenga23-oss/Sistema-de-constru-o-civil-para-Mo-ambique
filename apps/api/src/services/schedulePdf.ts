import puppeteer from "puppeteer";
import type { getProjectSchedule } from "./scheduleEngine.js";

type Schedule = Awaited<ReturnType<typeof getProjectSchedule>>;
type ProjectHeader = { name: string; client: string | null; currency: string };

const DAY_MS = 86_400_000;
const esc = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
const dateLabel = (value: string) => new Intl.DateTimeFormat("pt-PT", { day: "2-digit", month: "short", year: "2-digit", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`));
const money = (value: number, currency: string) => new Intl.NumberFormat("pt-PT", { style: "currency", currency, maximumFractionDigits: 0 }).format(value);

export function buildScheduleHtml(project: ProjectHeader, schedule: Schedule) {
  const startMs = new Date(`${schedule.startDate}T00:00:00Z`).getTime();
  const endMs = new Date(`${schedule.endDate}T00:00:00Z`).getTime();
  const span = Math.max(DAY_MS, endMs - startMs + DAY_MS);
  const monthMarkers: { label: string; left: number }[] = [];
  const monthCursor = new Date(startMs);
  monthCursor.setUTCDate(1);
  if (monthCursor.getTime() < startMs) monthCursor.setUTCMonth(monthCursor.getUTCMonth() + 1);
  while (monthCursor.getTime() <= endMs) {
    monthMarkers.push({ label: monthCursor.toLocaleDateString("pt-PT", { month: "short", year: "2-digit", timeZone: "UTC" }), left: ((monthCursor.getTime() - startMs) / span) * 100 });
    monthCursor.setUTCMonth(monthCursor.getUTCMonth() + 1);
  }

  const rows = schedule.tasks.map((task) => {
    const left = ((new Date(`${task.startDate}T00:00:00Z`).getTime() - startMs) / span) * 100;
    const width = Math.max(1.2, ((new Date(`${task.endDate}T00:00:00Z`).getTime() - new Date(`${task.startDate}T00:00:00Z`).getTime() + DAY_MS) / span) * 100);
    const baselineLeft = task.baselineStartDate ? ((new Date(`${task.baselineStartDate}T00:00:00Z`).getTime() - startMs) / span) * 100 : left;
    const baselineWidth = task.baselineStartDate && task.baselineEndDate
      ? Math.max(1, ((new Date(`${task.baselineEndDate}T00:00:00Z`).getTime() - new Date(`${task.baselineStartDate}T00:00:00Z`).getTime() + DAY_MS) / span) * 100)
      : width;
    const statusLabel = { nao_iniciado: "Não iniciado", em_curso: "Em curso", bloqueado: "Bloqueado", concluido: "Concluído" }[task.status] ?? task.status;
    return `<tr>
      <td class="code">${esc(task.code)}</td><td class="task"><strong>${esc(task.name)}</strong><small>${esc(statusLabel)}</small></td>
      <td>${dateLabel(task.startDate)}</td><td>${dateLabel(task.endDate)}</td><td class="num">${task.durationDays} d</td><td class="num">${task.progress.toFixed(0)}%</td>
      <td class="gantt"><div class="gridlines">${monthMarkers.map((marker) => `<i style="left:${marker.left}%"></i>`).join("")}</div><span class="baseline" style="left:${baselineLeft}%;width:${baselineWidth}%"></span><span class="bar ${task.status}" style="left:${left}%;width:${width}%"><b style="width:${Math.min(100, task.progress)}%"></b></span></td>
    </tr>`;
  }).join("");

  return `<!doctype html><html><head><meta charset="utf-8"><style>
    @page{size:A3 landscape;margin:10mm 11mm 12mm}*{box-sizing:border-box}body{font-family:Arial,sans-serif;color:#162033;margin:0;font-size:8.5px}
    header{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #17233b;padding-bottom:5mm;margin-bottom:4mm}.brand{display:flex;gap:3mm;align-items:center}.mark{width:11mm;height:11mm;border-radius:3mm;background:#ef6c23;color:white;font:bold 17px Arial;display:grid;place-items:center}.brand h1{font-size:20px;letter-spacing:4px;margin:0}.brand p,.meta p{margin:1mm 0;color:#667085}.title{text-align:center}.title h2{font-size:16px;margin:0 0 1mm}.title p{margin:0;color:#667085}.meta{text-align:right}
    .metrics{display:flex;gap:4mm;margin-bottom:4mm}.metric{border:1px solid #d9e0ea;border-radius:2mm;padding:2.5mm 4mm;min-width:38mm}.metric span{display:block;color:#667085;text-transform:uppercase;font-size:7px;letter-spacing:.5px}.metric strong{font-size:13px}.progress{height:2mm;background:#e7ebf1;border-radius:5px;overflow:hidden;margin-top:1mm}.progress i{display:block;height:100%;background:#ef6c23}
    table{width:100%;border-collapse:collapse;table-layout:fixed}thead{display:table-header-group}th{background:#17233b;color:white;text-align:left;padding:2.3mm 1.8mm;font-size:7px;text-transform:uppercase;letter-spacing:.45px}td{border-bottom:1px solid #e3e7ed;padding:2.3mm 1.8mm;vertical-align:middle}tbody tr:nth-child(even){background:#f8fafc}.code{width:18mm;color:#3156a3;font-weight:bold}.task{width:62mm}.task small{display:block;color:#77839a;font-weight:normal;margin-top:.6mm}.num{text-align:right;width:17mm}.gantt{position:relative;width:auto;height:9mm;overflow:hidden}.gridlines{position:absolute;inset:0}.gridlines i{position:absolute;top:0;bottom:0;border-left:1px dashed #d7dce5}.baseline{position:absolute;height:1mm;top:1.2mm;background:#a4adbc;border-radius:2px}.bar{position:absolute;height:4mm;top:3mm;background:#cdd5e1;border-radius:1mm;overflow:hidden}.bar b{display:block;height:100%;background:#2f67d7}.bar.concluido b{background:#138c69}.bar.bloqueado{background:#f1d4d4}.bar.bloqueado b{background:#c64242}
    .months{margin-left:131mm;height:6mm;position:relative;border-bottom:1px solid #d9e0ea}.months span{position:absolute;font-weight:bold;color:#667085;transform:translateX(-50%)}footer{position:fixed;bottom:0;left:0;right:0;display:flex;justify-content:space-between;color:#77839a;font-size:7px}.legend{display:flex;gap:4mm;align-items:center;margin-top:3mm;color:#667085}.legend i{display:inline-block;width:7mm;height:2mm;margin-right:1mm;vertical-align:middle;background:#2f67d7}.legend .base{height:1mm;background:#a4adbc}.legend .done{background:#138c69}
  </style></head><body>
    <header><div class="brand"><div class="mark">S</div><div><h1>SIGA</h1><p>GESTÃO INTELIGENTE DE OBRAS</p></div></div><div class="title"><h2>CRONOGRAMA DE EXECUÇÃO</h2><p>${esc(project.name)}${project.client ? ` · Dono da obra: ${esc(project.client)}` : ""}</p></div><div class="meta"><strong>Planeamento base</strong><p>${dateLabel(schedule.startDate!)} — ${dateLabel(schedule.endDate!)}</p><p>Actualizado em ${new Intl.DateTimeFormat("pt-PT", { dateStyle: "medium" }).format(new Date())}</p></div></header>
    <div class="metrics"><div class="metric"><span>Progresso físico</span><strong>${schedule.overallProgress.toFixed(1)}%</strong><div class="progress"><i style="width:${Math.min(100, schedule.overallProgress)}%"></i></div></div><div class="metric"><span>Prazo útil</span><strong>${workingCalendarDays(schedule.startDate!, schedule.endDate!)} dias</strong></div><div class="metric"><span>Valor planeado</span><strong>${money(schedule.plannedValue, project.currency)}</strong></div><div class="metric"><span>Valor medido</span><strong>${money(schedule.executedValue, project.currency)}</strong></div></div>
    <div class="months">${monthMarkers.map((marker) => `<span style="left:${marker.left}%">${esc(marker.label)}</span>`).join("")}</div>
    <table><colgroup><col style="width:18mm"><col style="width:62mm"><col style="width:23mm"><col style="width:23mm"><col style="width:17mm"><col style="width:17mm"><col></colgroup><thead><tr><th>WBS</th><th>Tarefa / estado</th><th>Início</th><th>Fim</th><th>Duração</th><th>Execução</th><th>Linha temporal</th></tr></thead><tbody>${rows}</tbody></table>
    <div class="legend"><span><i class="base"></i>Linha de base</span><span><i></i>Execução em curso</span><span><i class="done"></i>Concluído</span></div>
    <footer><span>SIGA · Cronograma integrado ao Mapa de Quantidades, Diário de Obra e Autos de Medição</span><span>Formato A3 · Linha de base e progresso real</span></footer>
  </body></html>`;
}

function workingCalendarDays(start: string, end: string) {
  let cursor = new Date(`${start}T00:00:00Z`);
  const finalDate = new Date(`${end}T00:00:00Z`);
  let days = 0;
  while (cursor <= finalDate) {
    if (cursor.getUTCDay() !== 0) days += 1;
    cursor = new Date(cursor.getTime() + DAY_MS);
  }
  return days;
}

export async function buildSchedulePdf(project: ProjectHeader, schedule: Schedule) {
  if (!schedule.tasks.length || !schedule.startDate || !schedule.endDate) throw new Error("O cronograma ainda não tem tarefas");
  const browser = await puppeteer.launch({ args: ["--no-sandbox", "--disable-setuid-sandbox"] });
  try {
    const page = await browser.newPage();
    await page.setContent(buildScheduleHtml(project, schedule), { waitUntil: "networkidle0" });
    return Buffer.from(await page.pdf({ format: "A3", landscape: true, printBackground: true, margin: { top: "10mm", bottom: "12mm", left: "11mm", right: "11mm" } }));
  } finally {
    await browser.close();
  }
}
