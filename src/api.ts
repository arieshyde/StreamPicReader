import { invoke } from "@tauri-apps/api/core";

export interface WorkInfo {
  path: string;
  name: string;
  valid: boolean;
}

export interface Progress {
  version: number;
  lastChapter: string | null;
  imageIndex: number | null;
  offset: number | null;
}

export const listWorks = () => invoke<WorkInfo[]>("list_works");
export const addWork = (path: string) => invoke("add_work", { path });
export const removeWork = (path: string) => invoke("remove_work", { path });
export const listChapters = (workPath: string) =>
  invoke<{ name: string }[]>("list_chapters", { workPath });
export const listImages = (workPath: string, chapter: string) =>
  invoke<string[]>("list_images", { workPath, chapter });
export const readImage = (workPath: string, chapter: string, name: string) =>
  invoke<ArrayBuffer>("read_image", { workPath, chapter, name });
export const getProgress = (workPath: string) =>
  invoke<Progress>("get_progress", { workPath });
export const saveProgress = (workPath: string, progress: Progress) =>
  invoke("save_progress", { workPath, progress });
export const getLanguage = () => invoke<string>("get_language");
export const setLanguageApi = (language: string) =>
  invoke("set_language", { language });
