import type { Region } from "../../../src/modules/pdf-core/layout/model-runner"
import { modelFingerprint, sliceMatchesModel } from "./slice-format"

const HANDLE_DB = "pdf-verify-slice-directory"
const SLICE_VERSION = 1
const currentModelFingerprint = modelFingerprint(import.meta.env.PDF_VERIFY_MODEL_SHA256)
let directory: FileSystemDirectoryHandle | null = null
type WritableDirectoryHandle = FileSystemDirectoryHandle & {
  queryPermission(options: { mode: "readwrite" }): Promise<PermissionState>
}

interface SlicePage {
  key: string
  modelFingerprint?: string
  cssW: number
  cssH: number
  regions: Region[]
}

function openHandleDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(HANDLE_DB, 1)
    request.onupgradeneeded = () => request.result.createObjectStore("settings")
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export async function restoreSliceDirectory(): Promise<void> {
  const db = await openHandleDb()
  try {
    const saved = await new Promise<FileSystemDirectoryHandle | undefined>((resolve, reject) => {
      const request = db
        .transaction("settings", "readonly")
        .objectStore("settings")
        .get("directory")
      request.onsuccess = () => resolve(request.result as FileSystemDirectoryHandle | undefined)
      request.onerror = () => reject(request.error)
    })
    if (
      saved &&
      (await (saved as WritableDirectoryHandle).queryPermission({ mode: "readwrite" })) ===
        "granted"
    )
      directory = saved
  } finally {
    db.close()
  }
}

export function hasSliceDirectory(): boolean {
  return directory !== null
}

export async function chooseSliceDirectory(): Promise<void> {
  const picker = window as unknown as {
    showDirectoryPicker(options: {
      id: string
      mode: "readwrite"
    }): Promise<FileSystemDirectoryHandle>
  }
  const chosen = await picker.showDirectoryPicker({ id: "pdf-verify-slices", mode: "readwrite" })
  if (chosen.name !== "slices") throw new Error("请选择 MeowTabby/tools/pdf-verify/slices 文件夹")
  const db = await openHandleDb()
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction("settings", "readwrite")
      transaction.objectStore("settings").put(chosen, "directory")
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
      transaction.onabort = () => reject(transaction.error)
    })
    directory = chosen
  } finally {
    db.close()
  }
}

export async function sliceKey(file: File): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer())
  const hash = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("")
  return `${SLICE_VERSION}:${hash}`
}

function sliceFolderName(pdfKey: string): string {
  return `v${pdfKey.replace(":", "-")}`
}

export async function readSlicePage(
  pdfKey: string,
  page: number,
  cssW: number,
  cssH: number,
): Promise<Region[] | null> {
  if (!directory) throw new Error("尚未选择切片目录")
  let file: FileSystemFileHandle
  try {
    const folder = await directory.getDirectoryHandle(sliceFolderName(pdfKey))
    file = await folder.getFileHandle(`page-${page}.json`)
  } catch (error) {
    if (error instanceof DOMException && error.name === "NotFoundError") return null
    throw error
  }
  const saved = JSON.parse(await (await file.getFile()).text()) as SlicePage
  if (
    saved.key !== `${pdfKey}:${page}` ||
    saved.cssW !== cssW ||
    saved.cssH !== cssH ||
    !Array.isArray(saved.regions)
  )
    return null
  if (!sliceMatchesModel(saved, import.meta.env.PDF_VERIFY_MODEL_SHA256)) return null
  return saved.regions
}

export async function writeSlicePage(
  pdfKey: string,
  page: number,
  cssW: number,
  cssH: number,
  regions: Region[],
): Promise<void> {
  if (!directory) throw new Error("尚未选择切片目录")
  const folder = await directory.getDirectoryHandle(sliceFolderName(pdfKey), { create: true })
  const file = await folder.getFileHandle(`page-${page}.json`, { create: true })
  const writer = await file.createWritable()
  try {
    await writer.write(
      JSON.stringify({
        modelFingerprint: currentModelFingerprint,
        key: `${pdfKey}:${page}`,
        cssW,
        cssH,
        regions,
      } satisfies SlicePage),
    )
    await writer.close()
  } catch (error) {
    await writer.abort()
    throw error
  }
}
