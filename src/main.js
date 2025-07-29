import { fabric } from 'fabric';
import './style.css';
import './photo';
import './filter';
import sofaImage from './Sofa1.png';

fabric.textureSize = 4096;
fabric.filterBackend = new fabric.WebglFilterBackend();
fabric.isWebglSupported(fabric.textureSize);

const canvas = new fabric.Canvas(document.getElementById('canvas'), {
  backgroundColor: 'white',
  enableRetinaScaling: true,
});

function resizeCanvas() {
  canvas.setWidth(window.innerWidth);
  canvas.setHeight(window.innerHeight);
}

resizeCanvas();
window.addEventListener('resize', () => resizeCanvas(), false);

// https://glcouduser-11a82.kxcdn.com/1/savedDesign/thumbnails/43955.jpeg
const photo = new fabric.Photo(sofaImage, {
  left: canvas.getWidth() / 2,
  top: canvas.getHeight() / 2,
  originX: 'center',
  originY: 'center',
});

canvas.add(photo);
canvas.setActiveObject(photo);

// 假設我們要透過 index.html 中的按鈕來執行 togglePerspective
const toggleButton = document.getElementById('toggleButton');

// 監聽按鈕點擊事件
toggleButton.addEventListener('click', () => {
  const currentMode = photo.perspectiveMode;
  console.log('currentMode:', currentMode);
  photo.togglePerspective(!currentMode);

  // 最後請求重新渲染 canvas
  canvas.requestRenderAll();
});

// --- Zoom Functionality ---
const zoomLevelDiv = document.getElementById('zoomLevel');

function updateZoomDisplay() {
  const zoom = canvas.getZoom();
  zoomLevelDiv.innerText = `${Math.round(zoom * 100)}%`;
}

canvas.on('mouse:wheel', function (opt) {
  const delta = opt.e.deltaY;
  let zoom = canvas.getZoom();
  zoom *= 0.999 ** delta;
  if (zoom > 20) zoom = 20;
  if (zoom < 0.1) zoom = 0.1;
  canvas.zoomToPoint({ x: opt.e.offsetX, y: opt.e.offsetY }, zoom);
  opt.e.preventDefault();
  opt.e.stopPropagation();

  // 更新縮放比例顯示
  updateZoomDisplay();
});

// Initial zoom display
updateZoomDisplay();
