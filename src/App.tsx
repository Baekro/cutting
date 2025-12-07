import { useState, useRef, useEffect } from 'react'
import { Download, Upload, Trash2, ZoomIn, ZoomOut } from 'lucide-react'
import './App.css'

// 타입 정의
interface Point {
  x: number
  y: number
}

interface Path {
  points: Point[]
  color: string
  width: number
}

interface UploadedImage {
  id: number
  src: string
  img: HTMLImageElement
  x: number
  y: number
  scale: number
  paths: Path[]
}

function App() {
  const [images, setImages] = useState<UploadedImage[]>([])
  const [selectedImageId, setSelectedImageId] = useState<number | null>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files) return

    Array.from(files).forEach((file) => {
      const reader = new FileReader()
      reader.onload = (event: ProgressEvent<FileReader>) => {
        const target = event.target
        if (!target || !target.result) return

        const img = new Image()
        img.onload = () => {
          setImages((prev) => [
            ...prev,
            {
              id: Date.now() + Math.random(),
              src: target.result as string,
              img,
              x: 50,
              y: 50,
              scale: 1,
              paths: [],
            },
          ])
        }
        img.src = target.result as string
      }
      reader.readAsDataURL(file)
    })
  }

  const detectEdges = (imageData: ImageData, width: number, height: number) => {
    const data = imageData.data

    const getPixel = (x: number, y: number) => {
      const i = (y * width + x) * 4
      return data[i]
    }

    const edgePoints: Point[] = []
    const visited = new Set<string>()

    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const current = getPixel(x, y)
        const neighbors = [
          getPixel(x - 1, y),
          getPixel(x + 1, y),
          getPixel(x, y - 1),
          getPixel(x, y + 1),
        ]

        const isEdge = neighbors.some((n) => Math.abs(n - current) > 30)
        if (isEdge && !visited.has(`${x},${y}`)) {
          edgePoints.push({ x, y })
          visited.add(`${x},${y}`)
        }
      }
    }

    return edgePoints
  }

  const catmullRomToBezier = (points: Point[]) => {
    if (points.length < 4) return points

    const bezierPoints: Point[] = []
    const tension = 0.5

    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[Math.max(0, i - 1)]
      const p1 = points[i]
      const p2 = points[i + 1]
      const p3 = points[Math.min(points.length - 1, i + 2)]

      const cp1x = p1.x + (p2.x - p0.x) / 6 * tension
      const cp1y = p1.y + (p2.y - p0.y) / 6 * tension
      const cp2x = p2.x - (p3.x - p1.x) / 6 * tension
      const cp2y = p2.y - (p3.y - p1.y) / 6 * tension

      bezierPoints.push(p1, { x: cp1x, y: cp1y }, { x: cp2x, y: cp2y }, p2)
    }

    return bezierPoints
  }

  const simplifyPath = (points: Point[], tolerance: number): Point[] => {
    if (points.length < 3) return points

    const douglasPeucker = (pts: Point[], epsilon: number): Point[] => {
      let dmax = 0
      let index = 0
      const end = pts.length - 1

      for (let i = 1; i < end; i++) {
        const d = perpendicularDistance(pts[i], pts[0], pts[end])
        if (d > dmax) {
          index = i
          dmax = d
        }
      }

      if (dmax > epsilon) {
        const left = douglasPeucker(pts.slice(0, index + 1), epsilon)
        const right = douglasPeucker(pts.slice(index), epsilon)
        return [...left.slice(0, -1), ...right]
      }

      return [pts[0], pts[end]]
    }

    const perpendicularDistance = (point: Point, lineStart: Point, lineEnd: Point) => {
      const dx = lineEnd.x - lineStart.x
      const dy = lineEnd.y - lineStart.y
      const mag = Math.sqrt(dx * dx + dy * dy)

      if (mag > 0) {
        const u = ((point.x - lineStart.x) * dx + (point.y - lineStart.y) * dy) / (mag * mag)
        const ix = lineStart.x + u * dx
        const iy = lineStart.y + u * dy
        const ddx = point.x - ix
        const ddy = point.y - iy
        return Math.sqrt(ddx * ddx + ddy * ddy)
      }

      return Math.sqrt((point.x - lineStart.x) ** 2 + (point.y - lineStart.y) ** 2)
    }

    return douglasPeucker(points, tolerance)
  }

  const connectNearbyPoints = (points: Point[]) => {
    const maxDistance = 50
    const connectedPaths: Point[][] = []
    const visited = new Set<number>()

    points.forEach((point, idx) => {
      if (visited.has(idx)) return

      const path: Point[] = [point]
      visited.add(idx)

      let current = point
      let foundNext = true

      while (foundNext) {
        foundNext = false
        let nearestIdx = -1
        let nearestDist = maxDistance

        points.forEach((p, i) => {
          if (visited.has(i)) return
          const dist = Math.sqrt((p.x - current.x) ** 2 + (p.y - current.y) ** 2)
          if (dist < nearestDist) {
            nearestDist = dist
            nearestIdx = i
            foundNext = true
          }
        })

        if (foundNext && nearestIdx !== -1) {
          current = points[nearestIdx]
          path.push(current)
          visited.add(nearestIdx)
        }
      }

      if (path.length > 2) {
        connectedPaths.push(path)
      }
    })

    return connectedPaths
  }

  const offsetPath = (points: Point[], offsetValue: number) => {
    if (points.length < 2) return points

    const offsetPoints: Point[] = []

    for (let i = 0; i < points.length; i++) {
      const prev = points[i - 1] || points[i]
      const curr = points[i]
      const next = points[i + 1] || points[i]

      const dx1 = curr.x - prev.x
      const dy1 = curr.y - prev.y
      const len1 = Math.sqrt(dx1 * dx1 + dy1 * dy1)
      const norm1x = len1 > 0 ? -dy1 / len1 : 0
      const norm1y = len1 > 0 ? dx1 / len1 : 0

      const dx2 = next.x - curr.x
      const dy2 = next.y - curr.y
      const len2 = Math.sqrt(dx2 * dx2 + dy2 * dy2)
      const norm2x = len2 > 0 ? -dy2 / len2 : 0
      const norm2y = len2 > 0 ? dx2 / len2 : 0

      const avgNormX = (norm1x + norm2x) / 2
      const avgNormY = (norm1y + norm2y) / 2
      const len = Math.sqrt(avgNormX * avgNormX + avgNormY * avgNormY)

      const finalNormX = len > 0 ? avgNormX / len : 0
      const finalNormY = len > 0 ? avgNormY / len : 0

      offsetPoints.push({
        x: curr.x + finalNormX * offsetValue,
        y: curr.y + finalNormY * offsetValue,
      })
    }

    return offsetPoints
  }

  const generateCuttingLines = (img: UploadedImage, imageId: number) => {
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    canvas.width = img.img.width
    canvas.height = img.img.height
    ctx.drawImage(img.img, 0, 0)

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
    const edgePoints = detectEdges(imageData, canvas.width, canvas.height)
    const connectedPaths = connectNearbyPoints(edgePoints)

    setImages((prev) =>
      prev.map((image) =>
        image.id === imageId
          ? {
              ...image,
              paths: connectedPaths.map((pathPoints) => {
                const simplified = simplifyPath(pathPoints, 2)
                const smoothed = catmullRomToBezier(simplified)
                const offset = offsetPath(smoothed, 3)
                return {
                  points: offset,
                  color: '#ff0000',
                  width: 2,
                }
              }),
            }
          : image
      )
    )

    drawCanvas()
  }

  const drawCanvas = () => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.clearRect(0, 0, canvas.width, canvas.height)

    images.forEach((img) => {
      ctx.save()
      ctx.translate(img.x, img.y)
      ctx.scale(img.scale, img.scale)
      ctx.drawImage(img.img, 0, 0)

      img.paths.forEach((obj) => {
        if (obj.points.length < 2) return

        ctx.beginPath()
        ctx.strokeStyle = obj.color
        ctx.lineWidth = obj.width / img.scale
        ctx.moveTo(obj.points[0].x, obj.points[0].y)

        for (let i = 1; i < obj.points.length; i++) {
          ctx.lineTo(obj.points[i].x, obj.points[i].y)
        }

        ctx.stroke()
      })

      ctx.restore()
    })
  }

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas) return

    const rect = canvas.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top

    for (let i = images.length - 1; i >= 0; i--) {
      const img = images[i]
      const imgWidth = img.img.width * img.scale
      const imgHeight = img.img.height * img.scale

      if (x >= img.x && x <= img.x + imgWidth && y >= img.y && y <= img.y + imgHeight) {
        setSelectedImageId(img.id)
        return
      }
    }

    setSelectedImageId(null)
  }

  const handleZoom = (imageId: number, delta: number) => {
    setImages((prev) =>
      prev.map((img) =>
        img.id === imageId ? { ...img, scale: Math.max(0.1, img.scale + delta) } : img
      )
    )
  }

  const handleMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!selectedImageId) return

    const canvas = canvasRef.current
    if (!canvas) return

    setImages((prev) =>
      prev.map((img) => {
        if (img.id !== selectedImageId) return img

        return {
          ...img,
          x: img.x + e.movementX,
          y: img.y + e.movementY,
        }
      })
    )
  }

  const deleteImage = (id: number) => {
    setImages((prev) => prev.filter((img) => img.id !== id))
    if (selectedImageId === id) {
      setSelectedImageId(null)
    }
  }

  const downloadPDF = () => {
    setImages((prev) =>
      prev.map((img) =>
        img.id === selectedImageId
          ? {
              ...img,
              paths: [
                ...img.paths,
                {
                  points: [
                    { x: 0, y: 0 },
                    { x: img.img.width, y: 0 },
                    { x: img.img.width, y: img.img.height },
                    { x: 0, y: img.img.height },
                  ],
                  color: '#ff0000',
                  width: 2,
                },
              ],
            }
          : img
      )
    )
  }

  useEffect(() => {
    drawCanvas()
  }, [images])

  return (
    <div className="min-h-screen bg-gray-100 p-8">
      <div className="max-w-7xl mx-auto">
        <h1 className="text-3xl font-bold mb-8 text-center">PDF 칼선 생성기</h1>

        <div className="bg-white rounded-lg shadow-lg p-6 mb-6">
          <div className="flex gap-4 mb-4">
            <label className="flex items-center gap-2 px-4 py-2 bg-blue-500 text-white rounded cursor-pointer hover:bg-blue-600">
              <Upload size={20} />
              이미지 업로드
              <input
                type="file"
                multiple
                accept="image/*"
                onChange={handleImageUpload}
                className="hidden"
              />
            </label>
          </div>

          <canvas
            ref={canvasRef}
            width={800}
            height={600}
            onClick={handleCanvasClick}
            onMouseMove={handleMove}
            className="border border-gray-300 cursor-move"
          />
        </div>

        <div className="bg-white rounded-lg shadow-lg p-6">
          <h2 className="text-xl font-bold mb-4">이미지 목록</h2>
          <div className="space-y-2">
            {images.map((img) => (
              <div
                key={img.id}
                className={`flex items-center justify-between p-3 rounded ${
                  selectedImageId === img.id ? 'bg-blue-100' : 'bg-gray-50'
                }`}
              >
                <div className="flex items-center gap-3">
                  <img src={img.src} alt="" className="w-16 h-16 object-cover rounded" />
                  <span>배율: {(img.paths.length > 0 ? '칼선 생성됨' : '대기중')}</span>
                </div>

                <div className="flex gap-2">
                  <button
                    onClick={() => generateCuttingLines(img, img.id)}
                    className="px-3 py-1 bg-green-500 text-white rounded hover:bg-green-600"
                  >
                    칼선 생성
                  </button>
                  <button
                    onClick={() => handleZoom(img.id, 0.1)}
                    className="p-2 bg-gray-200 rounded hover:bg-gray-300"
                  >
                    <ZoomIn size={16} />
                  </button>
                  <button
                    onClick={() => handleZoom(img.id, -0.1)}
                    className="p-2 bg-gray-200 rounded hover:bg-gray-300"
                  >
                    <ZoomOut size={16} />
                  </button>
                  <button
                    onClick={() => deleteImage(img.id)}
                    className="p-2 bg-red-500 text-white rounded hover:bg-red-600"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            ))}
          </div>

          {selectedImageId && (
            <button
              onClick={downloadPDF}
              className="mt-4 w-full flex items-center justify-center gap-2 px-4 py-3 bg-purple-500 text-white rounded hover:bg-purple-600"
            >
              <Download size={20} />
              PDF 다운로드
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

export default App