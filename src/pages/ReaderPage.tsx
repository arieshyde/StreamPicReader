import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Lang, t } from "../i18n";
import {
  getProgress,
  listImages,
  readImage,
  saveProgress,
  Progress,
} from "../api";

const GAP = 2;
const EST_RATIO = 1.4;
const PRELOAD_MARGIN = "1500px 0px";

interface Props {
  lang: Lang;
  workPath: string;
  workName: string;
  chapter: string;
  resume: boolean;
  prevChapter: string | null;
  nextChapter: string | null;
  onBack: () => void;
  onHome: () => void;
  onSelectChapter: (chapter: string) => void;
}

interface Size {
  w: number;
  h: number;
}

// 显示尺寸：宽度取“窗口宽与图片自然宽度”的较小值，高度按原始长宽比计算
function computeSize(nat: Size, containerW: number): Size {
  const dw = Math.min(containerW, nat.w);
  return { w: dw, h: (nat.h / nat.w) * dw };
}

export default function ReaderPage({
  lang,
  workPath,
  workName,
  chapter,
  resume,
  prevChapter,
  nextChapter,
  onBack,
  onHome,
  onSelectChapter,
}: Props) {
  const [names, setNames] = useState<string[]>([]);
  const [urls, setUrls] = useState<(string | null)[]>([]);
  const [sizes, setSizes] = useState<(Size | null)[]>([]);
  const [failed, setFailed] = useState<boolean[]>([]);
  const [width, setWidth] = useState(800);
  const [progress, setProgress] = useState<Progress | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLDivElement | null)[]>([]);
  const sizesRef = useRef<(Size | null)[]>([]);
  const naturalRef = useRef<(Size | null)[]>([]);
  const loadingSet = useRef(new Set<number>());
  const urlsRef = useRef<(string | null)[]>([]);
  const failedRef = useRef<boolean[]>([]);
  // 话代际：切话/卸载时递增，用于丢弃旧话在途的异步结果，避免污染新话状态
  const genRef = useRef(0);
  const restored = useRef(false);
  const saveTimer = useRef<number | null>(null);
  // 恢复锚点：目标图片序号 + 目标图片内的偏移，用于高度变化时动态修正滚动位置
  const anchorRef = useRef<{ index: number; offset: number } | null>(null);
  // 窗口缩放锚点：缩放前可视区顶部图片的序号 + 偏移 + 高度，用于缩放后补偿滚动位置
  const resizeAnchor = useRef<{ index: number; offset: number; height: number } | null>(null);
  // 程序化滚动计数：区分“代码设置 scrollTop”与“用户滚动”
  const programmaticScrolls = useRef(0);
  const progressRef = useRef<Progress>({
    version: 1,
    lastChapter: chapter,
    imageIndex: null,
    offset: null,
  });

  const applyScrollTop = (v: number) => {
    const sc = scrollRef.current;
    if (!sc) return;
    // 位置未变化时浏览器不会派发 scroll 事件，直接返回避免计数残留
    if (sc.scrollTop === v) return;
    programmaticScrolls.current += 1;
    sc.scrollTop = v;
  };

  // 取当前可视区顶部对应的“图片序号 + 偏移 + 该项高度”
  const captureAnchor = useCallback(() => {
    const sc = scrollRef.current;
    if (!sc || names.length === 0) return null;
    let idx = 0;
    let offset = 0;
    for (let i = 0; i < names.length; i++) {
      const el = itemRefs.current[i];
      if (!el) continue;
      if (el.offsetTop <= sc.scrollTop) {
        idx = i;
        offset = sc.scrollTop - el.offsetTop;
      } else break;
    }
    const anchorEl = itemRefs.current[idx];
    return {
      index: idx,
      offset,
      height: anchorEl ? anchorEl.offsetHeight : 0,
    };
  }, [names]);

  useEffect(() => {
    const sc = scrollRef.current;
    if (sc) setWidth(sc.clientWidth);
    restored.current = false;
    anchorRef.current = null;
    setProgress(null);
    naturalRef.current = [];
    // 递增代际使旧话在途请求全部失效，并清空加载中集合
    const gen = ++genRef.current;
    loadingSet.current.clear();
    listImages(workPath, chapter)
      .then(async (imgs) => {
        if (genRef.current !== gen) return;
        setNames(imgs);
        setUrls(new Array(imgs.length).fill(null));
        urlsRef.current = new Array(imgs.length).fill(null);
        setSizes(new Array(imgs.length).fill(null));
        sizesRef.current = new Array(imgs.length).fill(null);
        naturalRef.current = new Array(imgs.length).fill(null);
        setFailed(new Array(imgs.length).fill(false));
        failedRef.current = new Array(imgs.length).fill(false);
        itemRefs.current = new Array(imgs.length).fill(null);
        const p = await getProgress(workPath).catch(() => null);
        if (genRef.current !== gen) return;
        setProgress(p);
      })
      .catch(() => {});
    return () => {
      // 切话/卸载：使在途请求失效，并回收全部已创建的 objectURL（R11 内存释放）
      genRef.current += 1;
      loadingSet.current.clear();
      urlsRef.current.forEach((u) => u && URL.revokeObjectURL(u));
      urlsRef.current = [];
      setUrls([]);
    };
  }, [workPath, chapter]);

  // 窗口尺寸变化：宽度不变则忽略；宽度变化则先记录缩放前锚点，再更新宽度。
  useEffect(() => {
    const measure = () => {
      const sc = scrollRef.current;
      if (sc) setWidth(sc.clientWidth);
    };
    const onResize = () => {
      const sc = scrollRef.current;
      if (!sc || sc.clientWidth === width) return;
      resizeAnchor.current = captureAnchor();
      setWidth(sc.clientWidth);
    };
    measure();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [chapter, captureAnchor, width]);

  // 容器宽度变化时，重算所有已测图片的显示尺寸（宽不超过自然宽，比例不变）。
  // 用 useLayoutEffect 让重算与滚动补偿都在本次绘制前完成，避免中间帧闪烁。
  useLayoutEffect(() => {
    const next = naturalRef.current.map((n) => (n ? computeSize(n, width) : null));
    sizesRef.current = next;
    setSizes(next);
  }, [width]);

  // 重算尺寸后按“缩放前锚点”补偿滚动位置，抵消锚点上方图片高度变化的累积漂移。
  useLayoutEffect(() => {
    const anchor = resizeAnchor.current;
    if (!anchor) return;
    resizeAnchor.current = null;
    const sc = scrollRef.current;
    const el = itemRefs.current[anchor.index];
    if (!sc || !el) return;
    const newHeight = el.offsetHeight;
    const ratio = anchor.height > 0 && newHeight > 0 ? newHeight / anchor.height : 1;
    applyScrollTop(el.offsetTop + anchor.offset * ratio);
  }, [sizes]);

  const loadImage = useCallback(
    async (idx: number) => {
      if (loadingSet.current.has(idx)) return;
      if (urlsRef.current[idx]) return;
      loadingSet.current.add(idx);
      // 捕获当前话代际：请求完成时若已切话/卸载则丢弃结果
      const gen = genRef.current;
      try {
        const buf = await readImage(workPath, chapter, names[idx]);
        const url = URL.createObjectURL(new Blob([buf]));
        if (genRef.current !== gen) {
          URL.revokeObjectURL(url);
          return;
        }
        setUrls((prev) => {
          if (prev[idx]) URL.revokeObjectURL(prev[idx]!);
          const a = [...prev];
          a[idx] = url;
          urlsRef.current = a;
          return a;
        });
      } catch {
        if (genRef.current === gen) {
          failedRef.current[idx] = true;
          setFailed((prev) => {
            const a = [...prev];
            a[idx] = true;
            return a;
          });
        }
      } finally {
        loadingSet.current.delete(idx);
      }
    },
    [workPath, chapter, names]
  );

  const unloadImage = useCallback((idx: number) => {
    setUrls((prev) => {
      if (!prev[idx]) return prev;
      URL.revokeObjectURL(prev[idx]!);
      const a = [...prev];
      a[idx] = null;
      urlsRef.current = a;
      return a;
    });
  }, []);

  useEffect(() => {
    if (names.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          const idx = Number((entry.target as HTMLElement).dataset.index);
          if (entry.isIntersecting) {
            // 读取/解码失败的图片不再重试，占位块保持稳定
            if (!failedRef.current[idx]) loadImage(idx);
          } else {
            unloadImage(idx);
          }
        });
      },
      { root: scrollRef.current, rootMargin: PRELOAD_MARGIN }
    );
    itemRefs.current.forEach((el) => el && observer.observe(el));
    return () => observer.disconnect();
  }, [names, loadImage, unloadImage]);

  useEffect(() => {
    if (restored.current || names.length === 0 || progress == null) return;
    restored.current = true;
    // 仅当“从列表/确认框进入且续读记录匹配当前话”时恢复位置；
    // 上一话/下一话切换（resume=false）永远从第一张开始。
    if (
      resume &&
      progress.lastChapter === chapter &&
      progress.imageIndex != null
    ) {
      anchorRef.current = {
        index: progress.imageIndex,
        offset: progress.offset ?? 0,
      };
      // 同步写入 progressRef，避免尚未滚动就退出时丢失恢复位置
      progressRef.current = {
        version: 1,
        lastChapter: chapter,
        imageIndex: progress.imageIndex,
        offset: progress.offset ?? 0,
      };
      requestAnimationFrame(() => {
        const el = itemRefs.current[progress.imageIndex!];
        if (el) applyScrollTop(el.offsetTop + (progress.offset ?? 0));
      });
    }
  }, [names, progress, resume, chapter]);

  const captureProgress = useCallback(() => {
    const anchor = captureAnchor();
    if (!anchor) return;
    progressRef.current = {
      version: 1,
      lastChapter: chapter,
      imageIndex: anchor.index,
      offset: anchor.offset,
    };
  }, [captureAnchor, chapter]);

  const flushProgress = useCallback(() => {
    // 仅在存在实际阅读位置时保存，避免把空记录覆盖到磁盘上，
    // 抹掉上次真实的“话 + 图片位置”记忆。
    if (progressRef.current.imageIndex == null) return;
    saveProgress(workPath, progressRef.current).catch(() => {});
  }, [workPath]);

  const onScroll = () => {
    if (programmaticScrolls.current > 0) {
      programmaticScrolls.current -= 1;
    } else {
      // 用户主动滚动：恢复锚点使命，此后不再自动修正位置
      anchorRef.current = null;
    }
    captureProgress();
    if (saveTimer.current == null) {
      saveTimer.current = window.setTimeout(() => {
        saveTimer.current = null;
        flushProgress();
      }, 1000);
    }
  };

  useEffect(
    () => () => {
      if (saveTimer.current != null) window.clearTimeout(saveTimer.current);
      // 退出/切话时只落盘已有记忆；captureProgress 只在用户真实滚动时更新 progressRef
      flushProgress();
    },
    [flushProgress]
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const sc = scrollRef.current;
      if (!sc) return;
      const step = 80;
      if (e.key === "ArrowDown") sc.scrollBy(0, step);
      else if (e.key === "ArrowUp") sc.scrollBy(0, -step);
      else if (e.key === "PageDown") sc.scrollBy(0, sc.clientHeight);
      else if (e.key === "PageUp") sc.scrollBy(0, -sc.clientHeight);
      else if (e.key === "Home") sc.scrollTo(0, 0);
      else if (e.key === "End") sc.scrollTo(0, sc.scrollHeight);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="reader">
      <header className="topbar reader-topbar">
        <button className="ghost" onClick={onHome}>
          {t(lang, "home")}
        </button>
        <span className="reader-title">
          {workName} · {chapter}
        </span>
        <button className="ghost" onClick={onBack}>
          ← {t(lang, "back")}
        </button>
      </header>

      <div
        ref={scrollRef}
        key={chapter}
        className="reader-scroll"
        onScroll={onScroll}
      >
        <div className="reader-inner">
          {names.length === 0 && <p className="empty">{t(lang, "loading")}</p>}
          {names.map((n, i) => (
            <div
              key={n}
              ref={(el) => {
                itemRefs.current[i] = el;
              }}
              data-index={i}
              className="reader-item"
              style={{
                height: sizes[i]?.h ?? width * EST_RATIO,
                marginBottom: i === names.length - 1 ? 0 : GAP,
              }}
            >
              {failed[i] ? (
                <div className="img-error">
                  {t(lang, "imageLoadFailed")}: {n}
                </div>
              ) : urls[i] ? (
                <img
                  src={urls[i]!}
                  alt={n}
                  style={
                    sizes[i]
                      ? { width: sizes[i]!.w, height: sizes[i]!.h }
                      : undefined
                  }
                  onLoad={(e) => {
                    const im = e.currentTarget;
                    if (im.naturalWidth === 0) return;
                    const nat = { w: im.naturalWidth, h: im.naturalHeight };
                    naturalRef.current[i] = nat;
                    const size = computeSize(nat, width);
                    const oldH = sizesRef.current[i]?.h ?? width * EST_RATIO;
                    sizesRef.current[i] = size;
                    // 恢复锚点生效期间：锚点之前的图片高度变化时，
                    // 按差值补偿滚动位置，保证定位的图片不漂移
                    const anchor = anchorRef.current;
                    if (anchor && i < anchor.index) {
                      applyScrollTop(
                        (scrollRef.current?.scrollTop ?? 0) +
                          (size.h - oldH)
                      );
                    }
                    setSizes((prev) => {
                      const a = [...prev];
                      a[i] = size;
                      return a;
                    });
                  }}
                  onError={() => {
                    // R23：文件可读但解码失败 → 原位占位块，滚动流不中断
                    failedRef.current[i] = true;
                    setFailed((prev) => {
                      const a = [...prev];
                      a[i] = true;
                      return a;
                    });
                    setUrls((prev) => {
                      if (!prev[i]) return prev;
                      URL.revokeObjectURL(prev[i]!);
                      const a = [...prev];
                      a[i] = null;
                      urlsRef.current = a;
                      return a;
                    });
                  }}
                />
              ) : null}
            </div>
          ))}
        </div>
      </div>

      <footer className="bottom-bar">
        {prevChapter ? (
          <button
            className="primary"
            onClick={() => onSelectChapter(prevChapter)}
          >
            {t(lang, "prevChapter")}
          </button>
        ) : (
          <button className="primary" disabled>
            {t(lang, "firstChapter")}
          </button>
        )}
        {nextChapter ? (
          <button
            className="primary"
            onClick={() => onSelectChapter(nextChapter)}
          >
            {t(lang, "nextChapter")}
          </button>
        ) : (
          <button className="primary" disabled>
            {t(lang, "noMore")}
          </button>
        )}
      </footer>
    </div>
  );
}
