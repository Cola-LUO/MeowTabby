/** PDF 翻译入口的文件传递槽位：设置页「打开 PDF」选完文件后经 IndexedDB 一次性转交 viewer。
 *  blob URL 跨导航会失效、chrome.storage.local 有 10MB 配额不适合存大 PDF，
 *  IndexedDB 存 File 是引用式存储，大文件开销小。与扩展其它存储（dexie 的 AppDB）互不干扰。 */

const DB_NAME = "meowtabby-pdf-slot"
const STORE_NAME = "files"

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE_NAME)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, mode)
        const req = run(tx.objectStore(STORE_NAME))
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
        tx.oncomplete = () => db.close()
      }),
  )
}

/** 写入待翻译 PDF，返回一次性消费的 key（放进 viewer 的 ?slot= 参数） */
export async function putPdfSlot(file: File): Promise<string> {
  const key = `pending-${Date.now()}`
  await withStore("readwrite", (store) => store.put(file, key))
  return key
}

/** 读出槽位里的 PDF 并立即删除（一次性消费，避免垃圾残留）。
 *  槽位不存在/已消费/IndexedDB 异常 → 返回 null（调用方降级为空白引导态）。 */
export async function takePdfSlot(key: string): Promise<File | null> {
  try {
    const file = await withStore<File | undefined>("readonly", (store) => store.get(key))
    await withStore("readwrite", (store) => store.delete(key))
    return file ?? null
  } catch (e) {
    console.warn("[pdf-slot] 读取槽位失败", e)
    return null
  }
}
