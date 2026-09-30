import type { FileContent } from "@opencode-ai/sdk/v2"
import { dataUrlFromMediaValue, mediaKindFromPath } from "../pierre/media"

export type MarkdownFileReader = (path: string) => Promise<FileContent | undefined>

function localImagePath(src: string) {
  if (!src || src.startsWith("//") || src.startsWith("#")) return
  if (/^[a-z][a-z\d+.-]*:/i.test(src) && !/^[a-z]:[\\/]/i.test(src)) return
  try {
    return decodeURIComponent(src.split(/[?#]/, 1)[0])
  } catch {
    return
  }
}

// Parse in an inert template so the browser never requests a local filename from
// the web app's session URL before we replace it with authenticated file content.
export function markdownImageContent(html: string) {
  const template = document.createElement("template")
  template.innerHTML = html
  for (const image of template.content.querySelectorAll("img")) {
    delete image.dataset.markdownImage
    const path = localImagePath(image.getAttribute("src") ?? "")
    if (!path) continue
    image.dataset.markdownImage = path
    image.removeAttribute("src")
    image.removeAttribute("srcset")
    image.loading = "lazy"
  }
  return template.content
}

type ImageRequest = {
  promise: Promise<string | undefined>
  done: boolean
  src?: string
}

// These reads stay outside Solid resources: a pending image must never suspend
// the timeline/virtualizer. Cache only this mounted Markdown's visible paths.
export function createMarkdownImages() {
  const requests = new Map<string, ImageRequest>()
  const bindings = new WeakMap<HTMLImageElement, ImageRequest>()
  let reader: MarkdownFileReader | undefined
  let disposed = false

  return {
    update(root: HTMLElement, readFile?: MarkdownFileReader) {
      if (reader !== readFile) {
        requests.clear()
        reader = readFile
      }
      const paths = new Set<string>()
      for (const image of root.querySelectorAll<HTMLImageElement>("img[data-markdown-image]")) {
        const path = image.dataset.markdownImage!
        paths.add(path)
        if (!readFile) {
          image.removeAttribute("src")
          bindings.delete(image)
          continue
        }
        const request = requests.get(path) ?? loadImage(readFile, path)
        requests.set(path, request)
        if (request.done) {
          if (request.src) image.src = request.src
          else image.removeAttribute("src")
          continue
        }
        image.removeAttribute("src")
        if (bindings.get(image) === request) continue
        bindings.set(image, request)
        void request.promise.then((src) => {
          if (disposed || requests.get(path) !== request || bindings.get(image) !== request) return
          if (!root.contains(image) || image.dataset.markdownImage !== path) return
          if (src) image.src = src
        })
      }
      for (const path of requests.keys()) {
        if (!paths.has(path)) requests.delete(path)
      }
    },
    dispose() {
      disposed = true
      requests.clear()
    },
  }
}

function loadImage(readFile: MarkdownFileReader, path: string): ImageRequest {
  const request: ImageRequest = {
    done: false,
    promise: Promise.resolve()
      .then(() => readFile(path))
      .then((value) => {
        if (!value) return
        // file.read returns UTF-8 SVGs as text without a MIME type.
        if (mediaKindFromPath(path) === "svg")
          return dataUrlFromMediaValue({ ...value, mimeType: "image/svg+xml" }, "svg")
        return dataUrlFromMediaValue(value, "image")
      })
      .catch(() => undefined)
      .then((src) => {
        request.done = true
        request.src = src
        return src
      }),
  }
  return request
}
