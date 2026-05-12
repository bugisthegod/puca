import React, { useEffect, useRef, useState } from "react";
import PucaMark from "./PucaMark";
import { useBackToClose } from "../hooks/useBackToClose";
import { useInstallPrompt } from "../hooks/useInstallPrompt";
import { useLocale } from "../i18n";

export type ThemePref = "light" | "dark" | "system";
export type FabSide = "left" | "right";

type AboutModalProps = {
  onClose: () => void;
  onShowTour?: () => void;
  theme?: ThemePref;
  onSetTheme?: (t: ThemePref) => void;
  compassPref?: boolean;
  onToggleCompass?: (next: boolean) => void;
  fabSide?: FabSide;
  onSetFabSide?: (s: FabSide) => void;
};

const FEEDBACK_URL = "https://tally.so/r/lbKjNX";

function SettingRow({
  label,
  info,
  children,
}: {
  label: string;
  info?: string;
  children: React.ReactNode;
}) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  return (
    <div className="about-setting-row">
      <span className="about-setting-row__head">
        <span className="about-setting-row__label">{label}</span>
        <span className="about-setting-row__info-wrap" ref={wrapRef}>
          {info && (
            <>
              <button
                type="button"
                className={`about-setting-row__info${open ? " is-open" : ""}`}
                aria-label={t("about.info.btn.aria", { label })}
                aria-expanded={open}
                onClick={() => setOpen((v) => !v)}
              >
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="12" cy="12" r="9" />
                  <line x1="12" y1="8" x2="12" y2="13" />
                  <circle cx="12" cy="16.5" r="0.6" fill="currentColor" stroke="none" />
                </svg>
              </button>
              {open && (
                <span className="about-setting-row__tip" role="tooltip">
                  {info}
                </span>
              )}
            </>
          )}
        </span>
      </span>
      <div className="about-setting-row__control">{children}</div>
    </div>
  );
}

export default function AboutModal({ onClose, onShowTour, theme, onSetTheme, compassPref, onToggleCompass, fabSide, onSetFabSide }: AboutModalProps) {
  const { locale, setLocale, t } = useLocale();
  useBackToClose(onClose);
  const { canInstall, isInstalled, triggerInstall } = useInstallPrompt();
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="about-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-label={t("about.dialog.aria")}>
      <div className="about-modal" onClick={(e) => e.stopPropagation()}>
        <div
          className={`about-modal__lang${scrolled ? " is-scrolled" : ""}`}
          role="radiogroup"
          aria-label={t("about.lang.label")}
        >
          <button
            type="button"
            role="radio"
            aria-checked={locale === "en"}
            className={`about-modal__lang__btn${locale === "en" ? " is-active" : ""}`}
            onClick={() => { if (locale !== "en") setLocale("en"); }}
          >
            EN
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={locale === "zh"}
            className={`about-modal__lang__btn${locale === "zh" ? " is-active" : ""}`}
            onClick={() => { if (locale !== "zh") setLocale("zh"); }}
          >
            中
          </button>
        </div>
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
        <div
          className="about-modal__scroll"
          onScroll={(e) => setScrolled(e.currentTarget.scrollTop > 8)}
        >
        <div className="about-hero">
          <div className="about-hero__mark">
            <PucaMark />
          </div>
          <h2 className="about-hero__name">Púca</h2>
          <div className="about-hero__pron">
            <span>POO-ka</span>
            <em>· {t("about.hero.subline")}</em>
          </div>
          <p className="about-hero__tag">
            {t("about.hero.tag")}
          </p>
        </div>

        <div className="about-divider" />

        {onShowTour && (
          <section className="about-block">
            <button type="button" className="about-tour-btn" onClick={onShowTour}>
              {t("about.tour.btn")}
            </button>
          </section>
        )}

        {(onSetTheme || onToggleCompass || onSetFabSide) && (<>
        <div className="about-divider" />
        <section className="about-block about-settings">
          {onSetTheme && theme && (
            <SettingRow
              label={t("about.appearance.label")}
              info={t("about.appearance.info")}
            >
              <div className="about-theme-toggle" role="radiogroup" aria-label={t("about.appearance.label")}>
                {(["light", "dark", "system"] as const).map((tp) => (
                  <button
                    key={tp}
                    type="button"
                    role="radio"
                    aria-checked={theme === tp}
                    className={`about-theme-btn${theme === tp ? " is-active" : ""}`}
                    onClick={() => { if (theme !== tp) onSetTheme(tp); }}
                  >
                    {tp === "light" ? t("about.theme.light") : tp === "dark" ? t("about.theme.dark") : t("about.theme.system")}
                  </button>
                ))}
              </div>
            </SettingRow>
          )}

          {onToggleCompass && (
            <SettingRow
              label={t("about.compass.label")}
              info={t("about.compass.info")}
            >
              <div className="about-theme-toggle" role="radiogroup" aria-label={t("about.compass.label")}>
                <button
                  type="button"
                  role="radio"
                  aria-checked={!compassPref}
                  className={`about-theme-btn${!compassPref ? " is-active" : ""}`}
                  onClick={() => onToggleCompass(false)}
                >
                  {t("about.compass.off")}
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={!!compassPref}
                  className={`about-theme-btn${compassPref ? " is-active" : ""}`}
                  onClick={() => onToggleCompass(true)}
                >
                  {t("about.compass.on")}
                </button>
              </div>
            </SettingRow>
          )}

          {onSetFabSide && fabSide && (
            <SettingRow
              label={t("about.fab.label")}
              info={t("about.fab.info")}
            >
              <div className="about-theme-toggle" role="radiogroup" aria-label={t("about.fab.label")}>
                <button
                  type="button"
                  role="radio"
                  aria-checked={fabSide === "left"}
                  className={`about-theme-btn${fabSide === "left" ? " is-active" : ""}`}
                  onClick={() => { if (fabSide !== "left") onSetFabSide("left"); }}
                >
                  {t("about.fab.left")}
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={fabSide === "right"}
                  className={`about-theme-btn${fabSide === "right" ? " is-active" : ""}`}
                  onClick={() => { if (fabSide !== "right") onSetFabSide("right"); }}
                >
                  {t("about.fab.right")}
                </button>
              </div>
            </SettingRow>
          )}
        </section>
        </>)}

        {!isInstalled && <>
        <div className="about-divider" />

        <section className="about-block">
          <div className="about-install-callout">
            <div className="about-install__heading">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="5" y="2" width="14" height="20" rx="2.5" />
                <path d="M11 18h2" />
              </svg>
              {t("about.install.heading")}
            </div>
            {canInstall && (
              <button
                type="button"
                className="about-install-btn"
                onClick={() => { void triggerInstall(); }}
              >
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M12 3v12" />
                  <path d="M7 10l5 5 5-5" />
                  <path d="M5 21h14" />
                </svg>
                {t("about.install.btn")}
              </button>
            )}
            <div className="about-install">
              <div className="about-install__card">
                <div className="about-install__platform">
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">
                    <path d="M17.6 13.3c0-2.3 1.9-3.4 2-3.5-1.1-1.6-2.8-1.8-3.4-1.8-1.4-.1-2.8.8-3.6.8-.7 0-1.9-.8-3.1-.8-1.6 0-3.1.9-3.9 2.4-1.7 2.9-.4 7.2 1.2 9.6.8 1.1 1.7 2.4 3 2.4 1.2-.1 1.6-.8 3.1-.8s1.8.8 3.1.8c1.3 0 2.1-1.2 2.9-2.3.9-1.3 1.3-2.6 1.3-2.7 0 0-2.6-1-2.6-4.1zM15.2 6.4c.7-.8 1.1-1.9 1-3-.9.1-2.1.6-2.7 1.4-.6.7-1.2 1.8-1 2.9 1 0 2-.5 2.7-1.3z" />
                  </svg>
                  {t("about.install.iphone.platform")}
                </div>
                <ol className="about-install__steps">
                  <li>{t("about.install.iphone.s1")}</li>
                  <li dangerouslySetInnerHTML={{ __html: t("about.install.iphone.s2") }} />
                  <li dangerouslySetInnerHTML={{ __html: t("about.install.iphone.s3") }} />
                </ol>
              </div>
              <div className="about-install__card">
                <div className="about-install__platform">
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">
                    <path d="M17.5 11.5a1 1 0 1 1 0-2 1 1 0 0 1 0 2zm-11 0a1 1 0 1 1 0-2 1 1 0 0 1 0 2zm10.9-5.6l1.4-2.4a.3.3 0 1 0-.5-.3l-1.4 2.4A8.3 8.3 0 0 0 12 4.2c-1.7 0-3.3.4-4.7 1.3L5.9 3.2a.3.3 0 1 0-.5.3l1.4 2.4A7.7 7.7 0 0 0 3.5 12h17a7.7 7.7 0 0 0-3.1-6.1zM3.5 13v6a1.5 1.5 0 0 0 1.5 1.5h1v2a1.5 1.5 0 0 0 3 0v-2h6v2a1.5 1.5 0 0 0 3 0v-2h1A1.5 1.5 0 0 0 20.5 19v-6h-17z" />
                  </svg>
                  {t("about.install.android.platform")}
                </div>
                <ol className="about-install__steps">
                  <li>{t("about.install.android.s1")}</li>
                  <li dangerouslySetInnerHTML={{ __html: t("about.install.android.s2") }} />
                </ol>
              </div>
            </div>
            <p className="about-install__note">{t("about.install.note")}</p>
          </div>
        </section>
        </>}

        <div className="about-divider" />

        <section className="about-block about-actions">
          <div className="about-action about-action--feedback">
            <p className="about-feedback-note">{t("about.feedback.note")}</p>
            <a
              href={FEEDBACK_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="about-feedback-btn"
            >
              {t("about.feedback.btn")}
            </a>
          </div>

          <div className="about-action about-action--donate">
            <p className="about-donate-note">{t("about.donate.note")}</p>
            <a
              href="https://buymeacoffee.com/bugisthegod"
              target="_blank"
              rel="noopener noreferrer"
              className="about-donate-btn"
            >
              <span aria-hidden="true">🍭</span>
              {t("about.donate.btn")}
            </a>
          </div>
        </section>

        <div className="about-divider" />

        <footer className="about-footer">
          {t("about.footer.line1")}
          <br />{t("about.footer.line2")}
        </footer>
        </div>
      </div>
    </div>
  );
}
