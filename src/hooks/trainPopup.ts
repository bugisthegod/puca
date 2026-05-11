import type { Train, TrainMovement } from "../types";
import { escapeHtml, fmtTime, parseLateMinutes, parseRoute, parseTrainProgress } from "../utils";
import { t } from "../i18n";

export function trainPopupStatusClass(status: string, late: number | null): string {
  if (status === "N" || status === "T") return "";
  if (late === null || late <= 0) return "";
  if (late >= 10) return "popup-status--red";
  return "popup-status--yellow";
}

// Irish Rail's PublicMessage sometimes contains literal "\n" (two chars)
// instead of an actual newline — escape first, then normalize both to <br>.
export function formatTrainPopupMessage(message: string): string {
  return escapeHtml(message).replace(/\\r\\n|\\n|\r?\n/g, "<br>");
}

export function buildTrainStatusText(status: string, late: number | null): string {
  if (status === "N") return t("popup.train.status.notrunning");
  if (status === "T") return t("popup.train.status.terminated");
  if (late === null) return t("popup.train.status.running");
  if (late === 0) return t("popup.status.ontime");
  if (late < 0) {
    const n = Math.abs(late);
    return n === 1 ? t("popup.status.early.one") : t("popup.status.early.many", { n });
  }
  return late === 1 ? t("popup.status.late.one") : t("popup.status.late.many", { n: late });
}

function trainPopupHeader(train: Train): string {
  const route = parseRoute(train.message);
  const late = parseLateMinutes(train.message);
  const statusText = buildTrainStatusText(train.status, late);

  return `
    <div class="popup-title">${escapeHtml(train.code)}</div>
    ${route ? `<div class="popup-route">${escapeHtml(route.origin)} → ${escapeHtml(route.destination)}</div>` : ""}
    <div class="popup-meta">
      <span class="popup-status ${trainPopupStatusClass(train.status, late)}">${statusText}</span>
      ${train.direction ? `<span class="popup-dir">${escapeHtml(train.direction)}</span>` : ""}
    </div>
  `;
}

function buildTrainPopupShell(train: Train, bodyHtml: string): string {
  return `
    <div class="popup-content">
      ${trainPopupHeader(train)}
      ${bodyHtml}
    </div>
  `;
}

export function buildTrainPopupHTML(train: Train): string {
  return buildTrainPopupShell(train, `<div class="popup-loading">${t("popup.train.loading")}</div>`);
}

export function buildTrainPopupErrorHTML(train: Train): string {
  return buildTrainPopupShell(train, `<div class="popup-message">${t("popup.train.error")}</div>`);
}

export function buildTrainPopupWithMovements(train: Train, movements: TrainMovement[]): string {
  const progress = parseTrainProgress(train.message);
  const normalizeStation = (name: string) => name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\bstation\b/gi, "")
    .replace(/[^a-z0-9]+/gi, "")
    .toLowerCase();
  const progressCurrent = progress ? normalizeStation(progress.currentStation) : "";
  const progressNext = progress?.nextStation ? normalizeStation(progress.nextStation) : "";
  const hasProgressCurrentMatch = progress
    ? movements.some((m) => normalizeStation(m.stationName) === progressCurrent)
    : false;
  const hasProgressNextMatch = progressNext
    ? movements.some((m) => normalizeStation(m.stationName) === progressNext)
    : false;
  const stopTypeLabel: Record<string, string> = {
    O: t("popup.train.stoptype.O"),
    T: t("popup.train.stoptype.T"),
    C: t("popup.train.stoptype.C"),
    N: t("popup.train.stoptype.N"),
    S: t("popup.train.stoptype.S"),
    D: t("popup.train.stoptype.D"),
  };

  const rows = movements
    .map((m) => {
      const normalizedStation = normalizeStation(m.stationName);
      const derivedStopType = hasProgressCurrentMatch && normalizedStation === progressCurrent
        ? "C"
        : hasProgressNextMatch && normalizedStation === progressNext
          ? "N"
          : hasProgressCurrentMatch && m.stopType === "C"
            ? "S"
          : hasProgressNextMatch && m.stopType === "N"
            ? "S"
            : m.stopType;
      const isCurrent = derivedStopType === "C";
      const rowClass = isCurrent ? "movement-current" : "";
      const schArr = fmtTime(m.scheduledArrival);
      const schDep = fmtTime(m.scheduledDepart);
      const expArr = fmtTime(m.expectedArrival);
      const expDep = fmtTime(m.expectedDepart);
      const actArr = fmtTime(m.arrival);
      const actDep = fmtTime(m.departure);

      // Show actual times if available, otherwise expected, otherwise scheduled.
      const showArr = actArr !== "—" ? actArr : expArr !== "—" ? expArr : schArr;
      const showDep = actDep !== "—" ? actDep : expDep !== "—" ? expDep : schDep;

      return `
        <tr class="${rowClass}">
          <td>${escapeHtml(m.stationName)}${isCurrent ? " ▶" : ""}</td>
          <td>${escapeHtml(stopTypeLabel[derivedStopType] ?? derivedStopType)}</td>
          <td>${showArr}</td>
          <td>${showDep}</td>
        </tr>
      `;
    })
    .join("");

  const bodyHtml = movements.length > 0
    ? `<div class="popup-table-wrap">
               <table class="movements-table">
                 <thead>
                   <tr>
                     <th>${t("popup.train.col.station")}</th>
                     <th>${t("popup.train.col.type")}</th>
                     <th>${t("popup.train.col.arr")}</th>
                     <th>${t("popup.train.col.dep")}</th>
                   </tr>
                 </thead>
                 <tbody>${rows}</tbody>
               </table>
             </div>`
    : `<div class="popup-message">${formatTrainPopupMessage(train.message)}</div>`;

  return buildTrainPopupShell(train, bodyHtml);
}
