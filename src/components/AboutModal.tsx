import React, { useEffect } from "react";
import PucaMark from "./PucaMark";
import { useBackToClose } from "../hooks/useBackToClose";

export type ThemePref = "light" | "dark" | "system";

type AboutModalProps = {
  onClose: () => void;
  onShowTour?: () => void;
  theme?: ThemePref;
  onSetTheme?: (t: ThemePref) => void;
  compassPref?: boolean;
  onToggleCompass?: (next: boolean) => void;
};

export default function AboutModal({ onClose, onShowTour, theme, onSetTheme, compassPref, onToggleCompass }: AboutModalProps) {
  useBackToClose(onClose);
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="about-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-label="About Púca">
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
        <div className="about-hero">
          <div className="about-hero__mark">
            <PucaMark />
          </div>
          <h2 className="about-hero__name">Púca</h2>
          <div className="about-hero__pron">
            <span>POO-ka</span>
            <em>· Irish folklore</em>
          </div>
          <p className="about-hero__tag">
            A shapeshifting spirit said to haunt Ireland's roads after dark —
            sometimes guiding weary travellers home, sometimes leading them
            astray for its own amusement. This map watches its modern cousins —
            trains and buses — as they flit across the island in real time.
          </p>
        </div>

        <div className="about-divider" />

        {onShowTour && (
          <section className="about-block">
            <button type="button" className="about-tour-btn" onClick={onShowTour}>
              Take the tour
            </button>
          </section>
        )}

        {onSetTheme && theme && (
          <>
            <div className="about-divider" />
            <section className="about-block">
              <div className="about-block__label">Appearance</div>
              <div className="about-theme-toggle" role="radiogroup" aria-label="Theme">
                {(["light", "dark", "system"] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    role="radio"
                    aria-checked={theme === t}
                    className={`about-theme-btn${theme === t ? " is-active" : ""}`}
                    onClick={() => { if (theme !== t) onSetTheme(t); }}
                  >
                    {t === "light" ? "Light" : t === "dark" ? "Dark" : "System"}
                  </button>
                ))}
              </div>
            </section>
          </>
        )}

        {onToggleCompass && (
          <>
            <div className="about-divider" />
            <section className="about-block">
              <div className="about-block__label">Compass</div>
              <div className="about-theme-toggle" role="radiogroup" aria-label="Compass">
                <button
                  type="button"
                  role="radio"
                  aria-checked={!compassPref}
                  className={`about-theme-btn${!compassPref ? " is-active" : ""}`}
                  onClick={() => onToggleCompass(false)}
                >
                  Off
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={!!compassPref}
                  className={`about-theme-btn${compassPref ? " is-active" : ""}`}
                  onClick={() => onToggleCompass(true)}
                >
                  On
                </button>
              </div>
              <p className="about-block__note">
                Shows which way you're facing on the map. iOS asks for motion
                permission after each reload — tap On again if the compass isn't
                showing.
              </p>
            </section>
          </>
        )}

        <div className="about-divider" />

        <section className="about-block">
          <div className="about-block__label">Add to Home Screen</div>
          <div className="about-install">
            <div className="about-install__card">
              <div className="about-install__platform">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">
                  <path d="M17.6 13.3c0-2.3 1.9-3.4 2-3.5-1.1-1.6-2.8-1.8-3.4-1.8-1.4-.1-2.8.8-3.6.8-.7 0-1.9-.8-3.1-.8-1.6 0-3.1.9-3.9 2.4-1.7 2.9-.4 7.2 1.2 9.6.8 1.1 1.7 2.4 3 2.4 1.2-.1 1.6-.8 3.1-.8s1.8.8 3.1.8c1.3 0 2.1-1.2 2.9-2.3.9-1.3 1.3-2.6 1.3-2.7 0 0-2.6-1-2.6-4.1zM15.2 6.4c.7-.8 1.1-1.9 1-3-.9.1-2.1.6-2.7 1.4-.6.7-1.2 1.8-1 2.9 1 0 2-.5 2.7-1.3z" />
                </svg>
                iPhone · Safari
              </div>
              <ol className="about-install__steps">
                <li>Tap the Share button.</li>
                <li>Scroll to <strong>Add to Home Screen</strong>.</li>
                <li>Tap <strong>Add</strong>.</li>
              </ol>
            </div>
            <div className="about-install__card">
              <div className="about-install__platform">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">
                  <path d="M17.5 11.5a1 1 0 1 1 0-2 1 1 0 0 1 0 2zm-11 0a1 1 0 1 1 0-2 1 1 0 0 1 0 2zm10.9-5.6l1.4-2.4a.3.3 0 1 0-.5-.3l-1.4 2.4A8.3 8.3 0 0 0 12 4.2c-1.7 0-3.3.4-4.7 1.3L5.9 3.2a.3.3 0 1 0-.5.3l1.4 2.4A7.7 7.7 0 0 0 3.5 12h17a7.7 7.7 0 0 0-3.1-6.1zM3.5 13v6a1.5 1.5 0 0 0 1.5 1.5h1v2a1.5 1.5 0 0 0 3 0v-2h6v2a1.5 1.5 0 0 0 3 0v-2h1A1.5 1.5 0 0 0 20.5 19v-6h-17z" />
                </svg>
                Android · Chrome
              </div>
              <ol className="about-install__steps">
                <li>Tap the menu (⋮).</li>
                <li>Tap <strong>Install app</strong> or <strong>Add to Home screen</strong>.</li>
              </ol>
            </div>
          </div>
          <p className="about-block__note">Launches full-screen, no browser chrome.</p>
        </section>

        <div className="about-divider" />

        <footer className="about-footer">
          Data from Irish Rail and the National Transport Authority.
          <br />Not affiliated with either.
        </footer>
        </div>
      </div>
    </div>
  );
}
