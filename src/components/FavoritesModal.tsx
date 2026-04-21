import React, { useEffect } from "react";
import type { Favorites, BusFavorite, TrainFavorite } from "../favorites";
import { busKey, trainKey } from "../favorites";
import type { BusOperator } from "../types";
import { useBackToClose } from "../hooks/useBackToClose";

type Props = {
  onClose: () => void;
  favs: Favorites;
  onPickBus: (f: BusFavorite) => void;
  onPickTrain: (f: TrainFavorite) => void;
  onRemoveBus: (key: string) => void;
  onRemoveTrain: (key: string) => void;
};

const OPERATOR_LABEL: Record<BusOperator, string> = {
  dublinbus: "Dublin Bus",
  buseireann: "Bus Éireann",
  goahead: "Go-Ahead",
};

export default function FavoritesModal({ onClose, favs, onPickBus, onPickTrain, onRemoveBus, onRemoveTrain }: Props) {
  useBackToClose(onClose);
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const empty = favs.buses.length === 0 && favs.trains.length === 0;

  return (
    <div className="about-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-label="Favorites">
      <div className="about-modal" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          className="about-modal__close"
          onClick={onClose}
          aria-label="Close"
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
        <div className="about-modal__scroll">
          <div className="about-block">
            <div className="about-block__label">Favorites</div>
            {empty && (
              <div className="fav-empty">
                No favorites yet. Tap the star next to a bus direction or train search to save it.
              </div>
            )}
            {favs.buses.length > 0 && (
              <>
                <div className="about-block__label" style={{ marginTop: 8 }}>Buses</div>
                <ul className="fav-list">
                  {favs.buses.map((b) => {
                    const k = busKey(b);
                    return (
                      <li key={k} className="fav-row">
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
                          aria-label={`Remove ${b.shortName} from favorites`}
                          title="Remove"
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
            {favs.trains.length > 0 && (
              <>
                <div className="about-block__label" style={{ marginTop: favs.buses.length > 0 ? 16 : 8 }}>Trains</div>
                <ul className="fav-list">
                  {favs.trains.map((t) => {
                    const k = trainKey(t);
                    return (
                      <li key={k} className="fav-row">
                        <button
                          type="button"
                          className="fav-row__main"
                          onClick={() => {
                            onPickTrain(t);
                            onClose();
                          }}
                        >
                          <span>{t.fromName} &rarr; {t.toName}</span>
                        </button>
                        <button
                          type="button"
                          className="fav-row__remove"
                          aria-label={`Remove ${t.fromName} to ${t.toName} from favorites`}
                          title="Remove"
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
