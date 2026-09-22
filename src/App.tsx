import { useEffect, useState } from "react";
import { Lang } from "./i18n";
import { getLanguage } from "./api";
import LibraryPage from "./pages/LibraryPage";
import WorkPage from "./pages/WorkPage";
import ReaderPage from "./pages/ReaderPage";

type View =
  | { page: "library" }
  | { page: "work"; workPath: string; workName: string }
  | {
      page: "reader";
      workPath: string;
      workName: string;
      chapters: string[];
      chapter: string;
      resume: boolean;
    };

export default function App() {
  const [lang, setLang] = useState<Lang>("zh");
  const [view, setView] = useState<View>({ page: "library" });

  useEffect(() => {
    getLanguage()
      .then((l) => setLang(l === "en" ? "en" : "zh"))
      .catch(() => {});
  }, []);

  if (view.page === "library") {
    return (
      <LibraryPage
        lang={lang}
        onLangChange={setLang}
        onOpenWork={(workPath, workName) =>
          setView({ page: "work", workPath, workName })
        }
      />
    );
  }

  if (view.page === "work") {
    return (
      <WorkPage
        lang={lang}
        workPath={view.workPath}
        workName={view.workName}
        onBack={() => setView({ page: "library" })}
        onOpenChapter={(chapters, chapter) =>
          setView({
            page: "reader",
            workPath: view.workPath,
            workName: view.workName,
            chapters,
            chapter,
            resume: true,
          })
        }
      />
    );
  }

  const idx = view.chapters.indexOf(view.chapter);
  return (
    <ReaderPage
      lang={lang}
      workPath={view.workPath}
      workName={view.workName}
      chapter={view.chapter}
      resume={view.resume}
      prevChapter={idx > 0 ? view.chapters[idx - 1] : null}
      nextChapter={
        idx >= 0 && idx < view.chapters.length - 1
          ? view.chapters[idx + 1]
          : null
      }
      onBack={() =>
        setView({
          page: "work",
          workPath: view.workPath,
          workName: view.workName,
        })
      }
      onHome={() => setView({ page: "library" })}
      onSelectChapter={(chapter) =>
        setView({ ...view, chapter, resume: false })
      }
    />
  );
}
