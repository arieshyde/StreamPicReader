import { useEffect, useRef, useState } from "react";
import { Lang, t } from "../i18n";
import { getProgress, listChapters, saveProgress } from "../api";

interface Props {
  lang: Lang;
  workPath: string;
  workName: string;
  onBack: () => void;
  onOpenChapter: (chapters: string[], chapter: string) => void;
}

export default function WorkPage({
  lang,
  workPath,
  workName,
  onBack,
  onOpenChapter,
}: Props) {
  const [chapters, setChapters] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [lastChapter, setLastChapter] = useState<string | null>(null);
  const [resumeChapter, setResumeChapter] = useState<string | null>(null);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    Promise.all([
      listChapters(workPath),
      getProgress(workPath).catch(() => null),
    ])
      .then(([chs, progress]) => {
        const names = chs.map((c) => c.name);
        setChapters(names);
        setLoaded(true);
        const last = progress?.lastChapter ?? null;
        // 续读记录指向的话仍存在于话列表中才保留，否则视为失效
        const lastExists = last != null && names.includes(last);
        setLastChapter(lastExists ? last : null);
        if (lastExists) {
          setResumeChapter(last);
          requestAnimationFrame(() => {
            const el = listRef.current?.querySelector('[data-last="1"]');
            el?.scrollIntoView({ block: "center" });
          });
        } else if (last != null && names.length > 0) {
          // 话被删除/改名：清除指向失效话的记录，避免残留脏数据
          saveProgress(workPath, {
            version: 1,
            lastChapter: null,
            imageIndex: null,
            offset: null,
          }).catch(() => {});
        }
      })
      .catch(() => {});
  }, [workPath]);

  return (
    <div className="page">
      <header className="topbar">
        <button className="ghost" onClick={onBack}>
          ← {t(lang, "back")}
        </button>
        <h1>{workName}</h1>
      </header>

      <ul className="chapter-list" ref={listRef}>
        {loaded && chapters.length === 0 && (
          <p className="empty">{t(lang, "emptyWork")}</p>
        )}
        {chapters.map((c) => (
          <li key={c}>
            <button
              className={
                c === lastChapter ? "chapter-item last-read" : "chapter-item"
              }
              data-last={c === lastChapter ? "1" : undefined}
              onClick={() => onOpenChapter(chapters, c)}
            >
              {c}
            </button>
          </li>
        ))}
      </ul>

      {resumeChapter && (
        <div className="modal-overlay">
          <div className="modal">
            <p className="modal-title">{t(lang, "resumeAsk")}</p>
            <p className="modal-sub">
              {workName} · {resumeChapter}
            </p>
            <div className="modal-actions">
              <button
                className="ghost"
                onClick={() => setResumeChapter(null)}
              >
                {t(lang, "resumeCancel")}
              </button>
              <button
                className="primary"
                onClick={() => onOpenChapter(chapters, resumeChapter)}
              >
                {t(lang, "resumeConfirm")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
