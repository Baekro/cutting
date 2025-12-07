import React, { useState, useRef, useEffect } from 'react';
import { Upload, Download, Minus, Plus, Trash2, Move, ZoomIn, ZoomOut, Maximize2 } from 'lucide-react';

export default function CutLineGenerator() {
  const [images, setImages] = useState([]);
  const [offset, setOffset] = useState(2);
  const [lineColor, setLineColor] = useState('magenta');
  const [smoothness, setSmoothness] = useState(2);
  const [canvasSize, setCanvasSize] = useState({ width: 800, height: 600 });
  const [selectedImage, setSelectedImage] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [showScaleModal, setShowScaleModal] = useState(false);
  const [tempScale, setTempScale] = useState(1);
  const canvasRef = useRef(null);
  const mmToPixel = 3.7795275591;
  const safeMargin = 2 * mmToPixel;
  const handleImageUpload = (e) => {
    const files = Array.from(e.target.files);
    
    files.forEach(file => {
      const reader = new FileReader();
      reader.onload = (event) => {
        const img = new Image();
        img.onload = () => {
          const newImage = {
            id: Date.now() + Math.random(),
            src: event.target.result,
            img: img,
            x: safeMargin,
            y: safeMargin,
            scale: 1,
            paths: []
          };
          
          processImagePaths(img, newImage.id);
          setImages(prev => [...prev, newImage]);
        };
        img.src = event.target.result;
      };
      reader.readAsDataURL(file);
    });
  };
  const findContours = (imageData, width, height) => {
    const data = imageData.data;

    const getAlpha = (x, y) => {
      if (x < 0 || x >= width || y < 0 || y >= height) return 0;
      return data[(y * width + x) * 4 + 3];
    };

    const isEdge = (x, y) => {
      const alpha = getAlpha(x, y);
      if (alpha < 128) return false;

      return (
        getAlpha(x - 1, y) < 128 ||
        getAlpha(x + 1, y) < 128 ||
        getAlpha(x, y - 1) < 128 ||
        getAlpha(x, y + 1) < 128
      );
    };

    const allOpaquePixels = [];
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (getAlpha(x, y) >= 128) {
          allOpaquePixels.push({ x, y });
        }
      }
    }

    if (allOpaquePixels.length === 0) return [];

    const getConvexHull = (points) => {
      if (points.length < 3) return points;

      const cross = (o, a, b) => {
        return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
      };

      points.sort((a, b) => a.x === b.x ? a.y - b.y : a.x - b.x);

      const lower = [];
      for (let i = 0; i < points.length; i++) {
        while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], points[i]) <= 0) {
          lower.pop();
        }
        lower.push(points[i]);
      }

      const upper = [];
      for (let i = points.length - 1; i >= 0; i--) {
        while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], points[i]) <= 0) {
          upper.pop();
        }
        upper.push(points[i]);
      }

      upper.pop();
      lower.pop();
      return lower.concat(upper);
    };

    const outerEdgePixels = allOpaquePixels.filter(p => isEdge(p.x, p.y));
    const hull = getConvexHull(outerEdgePixels);

    return [hull];
  };
  const simplifyContour = (points, tolerance) => {
    if (points.length < 3) return points;

    const douglasPeucker = (pts, epsilon) => {
      if (pts.length < 3) return pts;
      
      let dmax = 0;
      let index = 0;
      const end = pts.length - 1;

      for (let i = 1; i < end; i++) {
        const d = perpendicularDistance(pts[i], pts[0], pts[end]);
        if (d > dmax) {
          index = i;
          dmax = d;
        }
      }

      if (dmax > epsilon) {
        const left = douglasPeucker(pts.slice(0, index + 1), epsilon);
        const right = douglasPeucker(pts.slice(index), epsilon);
        return left.slice(0, -1).concat(right);
      }

      return [pts[0], pts[end]];
    };

    const perpendicularDistance = (point, lineStart, lineEnd) => {
      const dx = lineEnd.x - lineStart.x;
      const dy = lineEnd.y - lineStart.y;
      const norm = Math.sqrt(dx * dx + dy * dy);
      
      if (norm === 0) {
        return Math.sqrt(
          Math.pow(point.x - lineStart.x, 2) +
          Math.pow(point.y - lineStart.y, 2)
        );
      }

      return Math.abs(
        dy * point.x - dx * point.y + lineEnd.x * lineStart.y - lineEnd.y * lineStart.x
      ) / norm;
    };

    return douglasPeucker(points, tolerance);
  };

  const smoothContour = (points, iterations = 2) => {
    let smoothed = [...points];
    
    for (let iter = 0; iter < iterations; iter++) {
      const newPoints = [];
      for (let i = 0; i < smoothed.length; i++) {
        const prev = smoothed[(i - 1 + smoothed.length) % smoothed.length];
        const curr = smoothed[i];
        const next = smoothed[(i + 1) % smoothed.length];
        
        newPoints.push({
          x: (prev.x + curr.x * 2 + next.x) / 4,
          y: (prev.y + curr.y * 2 + next.y) / 4
        });
      }
      smoothed = newPoints;
    }
    
    return smoothed;
  };
  const applyOffset = (points, offsetValue) => {
    if (points.length < 3) return points;

    const offsetPoints = [];
    const mmToPixel = 3.7795275591;

    for (let i = 0; i < points.length; i++) {
      const prev = points[(i - 1 + points.length) % points.length];
      const curr = points[i];
      const next = points[(i + 1) % points.length];

      const v1x = curr.x - prev.x;
      const v1y = curr.y - prev.y;
      const len1 = Math.sqrt(v1x * v1x + v1y * v1y);
      const n1x = len1 > 0 ? -v1y / len1 : 0;
      const n1y = len1 > 0 ? v1x / len1 : 0;

      const v2x = next.x - curr.x;
      const v2y = next.y - curr.y;
      const len2 = Math.sqrt(v2x * v2x + v2y * v2y);
      const n2x = len2 > 0 ? -v2y / len2 : 0;
      const n2y = len2 > 0 ? v2x / len2 : 0;

      const nx = (n1x + n2x) / 2;
      const ny = (n1y + n2y) / 2;
      const nlen = Math.sqrt(nx * nx + ny * ny);

      if (nlen > 0) {
        const pixelOffset = offsetValue * mmToPixel;
        offsetPoints.push({
          x: curr.x - (nx / nlen) * pixelOffset,
          y: curr.y - (ny / nlen) * pixelOffset
        });
      } else {
        offsetPoints.push({ x: curr.x, y: curr.y });
      }
    }

    return offsetPoints;
  };
  const processImagePaths = (img, imageId) => {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = img.width;
    canvas.height = img.height;
    
    ctx.drawImage(img, 0, 0);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

    const contours = findContours(imageData, canvas.width, canvas.height);
    
    const processedPaths = contours.map((contour, idx) => {
      const simplified = simplifyContour(contour, smoothness);
      const smoothed = smoothContour(simplified, 2);
      const withOffset = applyOffset(smoothed, offset);
      return { id: idx, path: withOffset };
    });

    setImages(prev => prev.map(img => 
      img.id === imageId ? { ...img, paths: processedPaths } : img
    ));
  };

  useEffect(() => {
    images.forEach(img => {
      if (img.img) {
        processImagePaths(img.img, img.id);
      }
    });
  }, [offset, smoothness]);

  useEffect(() => {
    drawCanvas();
  }, [images, zoom, lineColor]);
  const drawCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    // 안전 영역 표시 (2mm 마진)
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 5]);
    ctx.strokeRect(safeMargin, safeMargin, canvas.width - safeMargin * 2, canvas.height - safeMargin * 2);
    ctx.setLineDash([]);
    
    const strokeColor = lineColor === 'magenta' ? '#FF00FF' : '#000000';
    
    images.forEach(image => {
      ctx.save();
      ctx.translate(image.x, image.y);
      ctx.scale(image.scale * zoom, image.scale * zoom);
      
      ctx.drawImage(image.img, 0, 0);
      
      image.paths.forEach(obj => {
        const pathPoints = obj.path;
        if (pathPoints.length > 0) {
          ctx.beginPath();
          ctx.moveTo(pathPoints[0].x, pathPoints[0].y);
          
          for (let i = 1; i < pathPoints.length; i++) {
            ctx.lineTo(pathPoints[i].x, pathPoints[i].y);
          }
          ctx.closePath();
          
          ctx.strokeStyle = strokeColor;
          ctx.lineWidth = 2 / (image.scale * zoom);
          ctx.stroke();
        }
      });
      
      ctx.restore();
      
      // 선택된 이미지 강조
      if (selectedImage === image.id) {
        ctx.strokeStyle = '#3b82f6';
        ctx.lineWidth = 3;
        ctx.setLineDash([10, 5]);
        const imgW = image.img.width * image.scale * zoom;
        const imgH = image.img.height * image.scale * zoom;
        ctx.strokeRect(image.x - 5, image.y - 5, imgW + 10, imgH + 10);
        ctx.setLineDash([]);
      }
    });
  };
  const handleCanvasMouseDown = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    const clickedImage = images.find(img => {
      const imgX = img.x;
      const imgY = img.y;
      const imgW = img.img.width * img.scale * zoom;
      const imgH = img.img.height * img.scale * zoom;
      
      return x >= imgX && x <= imgX + imgW && y >= imgY && y <= imgY + imgH;
    });
    
    if (clickedImage) {
      setSelectedImage(clickedImage.id);
      
      // 더블클릭 감지
      if (e.detail === 2) {
        const img = images.find(i => i.id === clickedImage.id);
        setTempScale(img.scale);
        setShowScaleModal(true);
      } else {
        setIsDragging(true);
        setDragStart({ x: x - clickedImage.x, y: y - clickedImage.y });
      }
    }
  };

  const handleCanvasMouseMove = (e) => {
    if (!isDragging || !selectedImage) return;
    
    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    setImages(prev => prev.map(img => {
      if (img.id === selectedImage) {
        let newX = x - dragStart.x;
        let newY = y - dragStart.y;
        
        // 안전 영역 제한 적용
        const imgW = img.img.width * img.scale * zoom;
        const imgH = img.img.height * img.scale * zoom;
        
        newX = Math.max(safeMargin, Math.min(newX, canvasSize.width - safeMargin - imgW));
        newY = Math.max(safeMargin, Math.min(newY, canvasSize.height - safeMargin - imgH));
        
        return { ...img, x: newX, y: newY };
      }
      return img;
    }));
  };

  const handleCanvasMouseUp = () => {
    setIsDragging(false);
  };
  const deleteImage = (id) => {
    setImages(prev => prev.filter(img => img.id !== id));
    if (selectedImage === id) setSelectedImage(null);
  };

  const applyScaleChange = () => {
    setImages(prev => prev.map(img => 
      img.id === selectedImage ? { ...img, scale: tempScale } : img
    ));
    setShowScaleModal(false);
  };

  const downloadSVG = () => {
    if (!images.length) return;
    const svg = createSVG();
    const blob = new Blob([svg], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'cutline.svg';
    a.click();
    URL.revokeObjectURL(url);
  };

  const createSVG = () => {
    const strokeColor = lineColor === 'magenta' 
      ? 'rgb(255, 0, 255)'
      : 'rgb(0, 0, 0)';
    
    let imageElements = '';
    let pathElements = '';
    
    images.forEach((image, imgIdx) => {
      imageElements += `    <image href="${image.src}" x="${image.x}" y="${image.y}" width="${image.img.width * image.scale}" height="${image.img.height * image.scale}"/>\n`;
      
      image.paths.forEach((obj, pathIdx) => {
        const pathPoints = obj.path;
        if (pathPoints.length > 0) {
          let pathData = `M ${(pathPoints[0].x * image.scale + image.x).toFixed(2)} ${(pathPoints[0].y * image.scale + image.y).toFixed(2)} `;
          for (let i = 1; i < pathPoints.length; i++) {
            pathData += `L ${(pathPoints[i].x * image.scale + image.x).toFixed(2)} ${(pathPoints[i].y * image.scale + image.y).toFixed(2)} `;
          }
          pathData += 'Z';
          pathElements += `    <path class="cutline" id="cutline-${imgIdx}-${pathIdx}" d="${pathData}"/>\n`;
        }
      });
    });
    
    return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${canvasSize.width}" height="${canvasSize.height}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <style>
      .cutline { 
        fill: none; 
        stroke: ${strokeColor}; 
        stroke-width: 1;
      }
    </style>
  </defs>
  <g id="image-layer">
${imageElements}  </g>
  <g id="cutlines-layer">
${pathElements}  </g>
</svg>`;
  };
  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-7xl mx-auto">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            Cut Line Generator
          </h1>
          <p className="text-gray-600">
            투명 배경 이미지에서 벡터 칼선 생성
          </p>
        </div>

        <div className="flex gap-6">
          <div className="flex-1 bg-white rounded-lg shadow p-6">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-semibold text-gray-900">작업 영역</h2>
              <div className="flex gap-2">
                <button
                  onClick={() => setZoom(Math.max(0.1, zoom - 0.1))}
                  className="p-2 rounded bg-gray-100 hover:bg-gray-200"
                >
                  <ZoomOut className="w-4 h-4" />
                </button>
                <span className="px-3 py-2 bg-gray-100 rounded text-sm">
                  {Math.round(zoom * 100)}%
                </span>
                <button
                  onClick={() => setZoom(Math.min(3, zoom + 0.1))}
                  className="p-2 rounded bg-gray-100 hover:bg-gray-200"
                >
                  <ZoomIn className="w-4 h-4" />
                </button>
              </div>
            </div>
            <div className="mb-3 p-3 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-sm text-red-700">
                ⚠️ 빨간 점선 안에 이미지를 배치하세요 (2mm 안전 영역)
              </p>
              <p className="text-xs text-red-600 mt-1">
                더블클릭으로 이미지 크기 조절 가능
              </p>
            </div>
            <div className="border border-gray-200 rounded-lg overflow-hidden bg-white">
              <canvas
                ref={canvasRef}
                width={canvasSize.width}
                height={canvasSize.height}
                onMouseDown={handleCanvasMouseDown}
                onMouseMove={handleCanvasMouseMove}
                onMouseUp={handleCanvasMouseUp}
                onMouseLeave={handleCanvasMouseUp}
                className="cursor-move"
                style={{ width: '100%', height: 'auto' }}
              />
            </div>
            {images.length > 0 && (
              <div className="mt-4 space-y-2">
                <h3 className="text-sm font-semibold text-gray-900">이미지 목록</h3>
                {images.map((img, idx) => (
                  <div
                    key={img.id}
                    className={`flex items-center justify-between p-3 rounded border-2 ${
                      selectedImage === img.id ? 'border-blue-500 bg-blue-50' : 'border-gray-200'
                    }`}
                  >
                    <div className="flex-1">
                      <span className="text-sm">이미지 {idx + 1} ({img.paths.length}개 패스)</span>
                      <div className="text-xs text-gray-500 mt-1">
                        크기: {Math.round(img.scale * 100)}% | 위치: ({Math.round(img.x)}, {Math.round(img.y)})
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => {
                          setSelectedImage(img.id);
                          setTempScale(img.scale);
                          setShowScaleModal(true);
                        }}
                        className="p-1 rounded hover:bg-blue-100 text-blue-600"
                        title="크기 조절"
                      >
                        <Maximize2 className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => deleteImage(img.id)}
                        className="p-1 rounded hover:bg-red-100 text-red-600"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="w-80 space-y-6">
            <div className="bg-white rounded-lg shadow p-6">
              <h3 className="text-sm font-semibold text-gray-900 mb-3">이미지 업로드</h3>
              <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed border-gray-300 rounded-lg cursor-pointer hover:border-gray-400 hover:bg-gray-50 transition-colors">
                <Upload className="w-10 h-10 text-gray-400 mb-2" />
                <span className="text-sm text-gray-500">PNG 파일 선택</span>
                <span className="text-xs text-gray-400 mt-1">다중 선택 가능</span>
                <input 
                  type="file" 
                  className="hidden" 
                  accept="image/png"
                  multiple
                  onChange={handleImageUpload}
                />
              </label>
            </div>

            <div className="bg-white rounded-lg shadow p-6">
              <h3 className="text-sm font-semibold text-gray-900 mb-3">대지 크기</h3>
              <div className="space-y-3">
                <div>
                  <label className="text-xs text-gray-600">너비 (px)</label>
                  <input
                    type="number"
                    value={canvasSize.width}
                    onChange={(e) => setCanvasSize(prev => ({ ...prev, width: parseInt(e.target.value) || 800 }))}
                    className="w-full mt-1 px-3 py-2 border border-gray-300 rounded"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-600">높이 (px)</label>
                  <input
                    type="number"
                    value={canvasSize.height}
                    onChange={(e) => setCanvasSize(prev => ({ ...prev, height: parseInt(e.target.value) || 600 }))}
                    className="w-full mt-1 px-3 py-2 border border-gray-300 rounded"
                  />
                </div>
              </div>
            </div>
            <div className="bg-white rounded-lg shadow p-6">
              <h3 className="text-sm font-semibold text-gray-900 mb-3">
                오프셋: {offset > 0 ? '+' : ''}{offset}mm
              </h3>
              <div className="flex items-center gap-3 mb-2">
                <button
                  onClick={() => setOffset(Math.max(-10, offset - 0.5))}
                  className="p-2 rounded bg-gray-100 hover:bg-gray-200"
                >
                  <Minus className="w-4 h-4" />
                </button>
                <input
                  type="range"
                  min="-10"
                  max="10"
                  step="0.5"
                  value={offset}
                  onChange={(e) => setOffset(parseFloat(e.target.value))}
                  className="flex-1"
                />
                <button
                  onClick={() => setOffset(Math.min(10, offset + 0.5))}
                  className="p-2 rounded bg-gray-100 hover:bg-gray-200"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>
              <p className="text-xs text-gray-500">
                음수: 바깥쪽 / 양수: 안쪽
              </p>
            </div>

            <div className="bg-white rounded-lg shadow p-6">
              <h3 className="text-sm font-semibold text-gray-900 mb-3">
                부드럽기: {smoothness.toFixed(1)}
              </h3>
              <div className="flex items-center gap-3 mb-2">
                <button
                  onClick={() => setSmoothness(Math.max(0.5, smoothness - 0.5))}
                  className="p-2 rounded bg-gray-100 hover:bg-gray-200"
                >
                  <Minus className="w-4 h-4" />
                </button>
                <input
                  type="range"
                  min="0.5"
                  max="5"
                  step="0.5"
                  value={smoothness}
                  onChange={(e) => setSmoothness(parseFloat(e.target.value))}
                  className="flex-1"
                />
                <button
                  onClick={() => setSmoothness(Math.min(5, smoothness + 0.5))}
                  className="p-2 rounded bg-gray-100 hover:bg-gray-200"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>
              <p className="text-xs text-gray-500">
                낮음: 정밀 / 높음: 부드러움
              </p>
            </div>
            <div className="bg-white rounded-lg shadow p-6">
              <h3 className="text-sm font-semibold text-gray-900 mb-3">선 색상</h3>
              <div className="space-y-2">
                <button
                  onClick={() => setLineColor('magenta')}
                  className={`w-full p-3 rounded-lg border-2 transition-colors ${
                    lineColor === 'magenta'
                      ? 'border-pink-500 bg-pink-50'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 bg-[#FF00FF] rounded"></div>
                    <div className="text-left">
                      <div className="text-sm font-medium">M100</div>
                      <div className="text-xs text-gray-500">Magenta</div>
                    </div>
                  </div>
                </button>
                <button
                  onClick={() => setLineColor('black')}
                  className={`w-full p-3 rounded-lg border-2 transition-colors ${
                    lineColor === 'black'
                      ? 'border-gray-700 bg-gray-50'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 bg-black rounded"></div>
                    <div className="text-left">
                      <div className="text-sm font-medium">K100</div>
                      <div className="text-xs text-gray-500">Black</div>
                    </div>
                  </div>
                </button>
              </div>
            </div>

            <div className="bg-white rounded-lg shadow p-6">
              <button
                onClick={downloadSVG}
                disabled={!images.length}
                className="w-full py-3 bg-gray-900 text-white rounded-lg font-medium hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
              >
                <Download className="w-4 h-4" />
                SVG 다운로드
              </button>
            </div>
          </div>
        </div>
      </div>
      {/* 크기 조절 모달 */}
      {showScaleModal && selectedImage && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-6 w-96">
            <h3 className="text-lg font-semibold mb-4">이미지 크기 조절</h3>
            <div className="space-y-4">
              <div>
                <label className="text-sm text-gray-600 block mb-2">
                  크기: {Math.round(tempScale * 100)}%
                </label>
                <input
                  type="range"
                  min="0.1"
                  max="3"
                  step="0.05"
                  value={tempScale}
                  onChange={(e) => setTempScale(parseFloat(e.target.value))}
                  className="w-full"
                />
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setTempScale(0.5)}
                  className="flex-1 px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded text-sm"
                >
                  50%
                </button>
                <button
                  onClick={() => setTempScale(1)}
                  className="flex-1 px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded text-sm"
                >
                  100%
                </button>
                <button
                  onClick={() => setTempScale(1.5)}
                  className="flex-1 px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded text-sm"
                >
                  150%
                </button>
                <button
                  onClick={() => setTempScale(2)}
                  className="flex-1 px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded text-sm"
                >
                  200%
                </button>
              </div>
              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => setShowScaleModal(false)}
                  className="flex-1 px-4 py-2 bg-gray-200 hover:bg-gray-300 rounded"
                >
                  취소
                </button>
                <button
                  onClick={applyScaleChange}
                  className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded"
                >
                  적용
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}