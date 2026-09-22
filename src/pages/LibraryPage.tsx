import { useCallback, useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { Lang, t } from "../i18n";
import {
  addWork,
  listWorks,
  removeWork,
  setLanguageApi,
  WorkInfo,
} from "../api";

interface Props {
  lang: Lang;
  onLangChange: (lang: Lang) => void;
  onOpenWork: (workPath: string, workName: string) => void;
}

export default function LibraryPage({
  lang,
  onLangChange,
  onOpenWork,
}: Props) {
  const [works, setWorks] = useState<WorkInfo[]>([]);
  const [invalidWork, setInvalidWork] = useState<WorkInfo | null>(null);

  const refresh = useCallback(() => {
    listWorks().then(setWorks).catch(() => {});
  }, []);

  useEffect(refresh, [refresh]);

  const remove = async (path: string) => {
    await removeWork(path).catch(() => {});
    refresh();
  };

  const pickAndAdd = async (replacePath?: string) => {
    const selected = await open({ directory: true });
    if (typeof selected !== "string") return false;
    if (replacePath) await removeWork(replacePath).catch(() => {});
    await addWork(selected).catch(() => {});
    refresh();
    return true;
  };

  const toggleLang = async () => {
    const next: Lang = lang === "zh" ? "en" : "zh";
    onLangChange(next);
    await setLanguageApi(next).catch(() => {});
  };

  return (
    <div className="page">
      <header className="topbar">
        <h1>{t(lang, "appTitle")}</h1>
        <button className="ghost" onClick={toggleLang}>
          {lang === "zh" ? "EN" : "中文"}
        </button>
      </header>

      {works.length === 0 && <p className="empty">{t(lang, "emptyLibrary")}</p>}

      <ul className="work-list">
        {works.map((w) => (
          <li
            key={w.path}
            className={w.valid ? "work-item" : "work-item invalid"}
          >
            <button
              className="work-name"
              onClick={() => {
                if (w.valid) onOpenWork(w.path, w.name);
                else setInvalidWork(w);
              }}
            >
              {w.name}
              {!w.valid && (
                <span className="tag">{t(lang, "pathInvalid")}</span>
              )}
            </button>
            <div className="work-actions">
              {!w.valid && (
                <button className="ghost" onClick={() => pickAndAdd(w.path)}>
                  {t(lang, "reselect")}
                </button>
              )}
              <button className="ghost danger" onClick={() => remove(w.path)}>
                {t(lang, "remove")}
              </button>
            </div>
          </li>
        ))}
      </ul>

      <footer className="bottom-bar">
        <button className="primary" onClick={() => pickAndAdd()}>
          {t(lang, "addWork")}
        </button>
      </footer>

      {invalidWork && (
        <div className="modal-overlay" onClick={() => setInvalidWork(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <p className="modal-title">{t(lang, "pathInvalid")}</p>
            <p className="modal-sub">{invalidWork.path}</p>
            <div className="modal-actions">
              <button className="ghost" onClick={() => setInvalidWork(null)}>
                {t(lang, "close")}
              </button>
              <button
                className="ghost danger"
                onClick={async () => {
                  await remove(invalidWork.path);
                  setInvalidWork(null);
                }}
              >
                {t(lang, "remove")}
              </button>
              <button
                className="primary"
                onClick={async () => {
                  const ok = await pickAndAdd(invalidWork.path);
                  if (ok) setInvalidWork(null);
                }}
              >
                {t(lang, "reselect")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
