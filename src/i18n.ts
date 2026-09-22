export type Lang = "zh" | "en";

const dict = {
  zh: {
    appTitle: "StreamPicReader",
    addWork: "添加漫画作品文件夹",
    emptyLibrary: "还没有作品，点击下方按钮添加",
    emptyWork: "该作品还没有可阅读的话",
    pathInvalid: "路径失效",
    reselect: "重新选择文件夹",
    remove: "移除",
    back: "返回",
    home: "主页",
    prevChapter: "上一话",
    nextChapter: "下一话",
    firstChapter: "第一话",
    noMore: "没有了",
    imageLoadFailed: "图片无法加载",
    loading: "加载中…",
    resumeAsk: "要从上次阅读位置继续吗？",
    resumeConfirm: "继续阅读",
    resumeCancel: "取消，查看列表",
    close: "关闭",
  },
  en: {
    appTitle: "StreamPicReader",
    addWork: "Add comic folder",
    emptyLibrary: "No works yet. Click the button below to add one",
    emptyWork: "No readable chapters in this work",
    pathInvalid: "Path invalid",
    reselect: "Re-select folder",
    remove: "Remove",
    back: "Back",
    home: "Home",
    prevChapter: "Previous",
    nextChapter: "Next",
    firstChapter: "First chapter",
    noMore: "No more",
    imageLoadFailed: "Failed to load image",
    loading: "Loading…",
    resumeAsk: "Resume from where you left off?",
    resumeConfirm: "Continue reading",
    resumeCancel: "Cancel, show list",
    close: "Close",
  },
} as const;

export type TKey = keyof typeof dict.zh;

export function t(lang: Lang, key: TKey): string {
  return dict[lang][key];
}
