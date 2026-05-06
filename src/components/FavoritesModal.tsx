import { useEffect } from "react";
import type { Favorites, BusFavorite, TrainFavorite, BusStopFavorite } from "../favorites";
import { busKey, trainKey, stopKey } from "../favorites";
import type { BusOperator } from "../types";
import { useBackToClose } from "../hooks/useBackToClose";
import { useLocale } from "../i18n";

type Props = {
  onClose: () => void;
  favs: Favorites;
  onPickBus: (f: BusFavorite) => void;
  onPickTrain: (f: TrainFavorite) => void;
  onPickStop: (f: BusStopFavorite) => void;
  onRemoveBus: (key: string) => void;
  onRemoveTrain: (key: string) => void;
  onRemoveStop: (key: string) => void;
};

const OPERATOR_LABEL: Record<BusOperator, string> = {
  dublinbus: "Dublin Bus",
  buseireann: "Bus Éireann",
  goahead: "Go-Ahead",
};

export default function FavoritesModal({ onClose, favs, onPickBus, onPickTrain, onPickStop, onRemoveBus, onRemoveTrain, onRemoveStop }: Props) {
  const { t } = useLocale();
  useBackToClose(onClose);
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const empty = favs.buses.length === 0 && favs.trains.length === 0 && favs.stops.length === 0;

  return (
    <div className="about-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-label={t("favs.dialog.aria")}>
      <div className="about-modal" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          className="about-modal__close"
          onClick={onClose}
          aria-label={t("about.close")}
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
        <div className="about-modal__scroll">
          <div className="about-block">
            <div className="about-block__label">{t("favs.title")}</div>
            {empty && (
              <div className="fav-empty">
                {t("favs.empty")}
              </div>
            )}
            {favs.buses.length > 0 && (
              <>
                <div className="about-block__label" style={{ marginTop: 8 }}>{t("favs.section.buses")}</div>
                <ul className="fav-list">
                  {favs.buses.map((b) => {
                    const k = busKey(b);
                    return (
                      <li key={k} className={`fav-row fav-row--${b.operator}`}>
                        <button
                          type="button"
                          className="fav-row__main"
                          onClick={() => {
                            onPickBus(b);
                            onClose();
                          }}
                        >
                          <strong>{b.shortName}</strong>
                          <span>&rarr; {b.headsign}</span>
                          <span className="route-operator-badge">{OPERATOR_LABEL[b.operator]}</span>
                        </button>
                        <button
                          type="button"
                          className="fav-row__remove"
                          aria-label={t("favs.remove.bus.aria", { name: b.shortName })}
                          title={t("favs.remove.title")}
                          onClick={(e) => {
                            e.stopPropagation();
                            onRemoveBus(k);
                          }}
                        >
                          &times;
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
            {favs.stops.length > 0 && (
              <>
                <div className="about-block__label" style={{ marginTop: favs.buses.length > 0 ? 16 : 8 }}>{t("favs.section.stops")}</div>
                <ul className="fav-list">
                  {favs.stops.map((s) => {
                    const k = stopKey(s);
                    return (
                      <li key={k} className={`fav-row fav-row--${s.operator}`}>
                        <button
                          type="button"
                          className="fav-row__main"
                          onClick={() => {
                            onPickStop(s);
                            onClose();
                          }}
                        >
                          <strong>{s.stopCode || s.stopId}</strong>
                          <span>{s.stopName}</span>
                          <span className="route-operator-badge">{OPERATOR_LABEL[s.operator]}</span>
                        </button>
                        <button
                          type="button"
                          className="fav-row__remove"
                          aria-label={t("favs.remove.stop.aria", { name: s.stopName })}
                          title={t("favs.remove.title")}
                          onClick={(e) => {
                            e.stopPropagation();
                            onRemoveStop(k);
                          }}
                        >
                          &times;
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
            {favs.trains.length > 0 && (
              <>
                <div className="about-block__label" style={{ marginTop: (favs.buses.length > 0 || favs.stops.length > 0) ? 16 : 8 }}>{t("favs.section.trains")}</div>
                <ul className="fav-list">
                  {favs.trains.map((tr) => {
                    const k = trainKey(tr);
                    return (
                      <li key={k} className="fav-row fav-row--train">
                        <button
                          type="button"
                          className="fav-row__main"
                          onClick={() => {
                            onPickTrain(tr);
                            onClose();
                          }}
                        >
                          <span>{tr.fromName} &rarr; {tr.toName}</span>
                        </button>
                        <button
                          type="button"
                          className="fav-row__remove"
                          aria-label={t("favs.remove.train.aria", { from: tr.fromName, to: tr.toName })}
                          title={t("favs.remove.title")}
                          onClick={(e) => {
                            e.stopPropagation();
                            onRemoveTrain(k);
                          }}
                        >
                          &times;
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
