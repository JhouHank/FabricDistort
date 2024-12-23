import { fabric } from 'fabric';

/**
 * Photo 子類別定義
 * @class fabric.Photo
 * @extends fabric.Image
 * @return {fabric.Photo} thisArg
 *
 * 此類別繼承自 fabric.Image，並擴充出照片的透視變形功能。
 * 在圖片載入後，可設定透視控制點，透過拖曳控制點改變圖片的透視效果。
 */
fabric.Photo = class extends fabric.Image {
  type = 'photo'; // 設定此物件的類型為 'photo'
  repeat = 'no-repeat'; // 圖片不重複填滿
  fill = 'transparent'; // 背景為透明
  initPerspective = true; // 是否初始化透視座標

  // 新增
  perspectiveMode = false;

  /**
   * 由於我們在此類別中會新增 perspectiveCoords 屬性，
   * 因此需要將該屬性加入到快取屬性中，以確保重新繪製及變化時的效率。
   */
  cacheProperties =
    fabric.Image.prototype.cacheProperties.concat('perspectiveCoords');

  /**
   * 建構子
   * @param {string} src 圖片的路徑或 URL
   * @param {object} options fabric 物件的相關選項 (如 left, top, scale...等)
   */
  constructor(src, options) {
    super(options);

    // 若有傳入 options，將選項套用至物件
    if (options) this.setOptions(options);

    // 當該物件加入到 canvas 中時觸發 'added' 事件
    this.on('added', () => {
      const image = new Image();
      image.setAttribute('crossorigin', 'anonymous'); // 避免跨域問題
      image.onload = () => {
        // 圖片載入完成後初始化元素
        this._initElement(image, options);
        // 計算並設定物件的寬高（根據載入圖片的原始大小並除以裝置像素倍率）
        this.width = image.width / fabric.devicePixelRatio;
        this.height = image.height / fabric.devicePixelRatio;
        this.loaded = true;
        this.setCoords(); // 設定控制點座標
        this.fire('image:loaded'); // 觸發自訂事件，表示圖片完成載入
      };
      image.src = src; // 開始載入圖片資源

      // 當 'image:loaded' 事件發生後執行，這裡表示圖片已經準備好
      this.on('image:loaded', () => {
        // 若還沒有初始化透視座標，則進行初始化
        !this.perspectiveCoords && this.getInitialPerspective();

        // 切換至透視模式
        // this.togglePerspective();
        // 請求 canvas 重新渲染
        this.canvas.requestRenderAll();
      });
    });
  }

  // 再次定義快取屬性確保 perspectiveCoords 屬性加入快取
  cacheProperties =
    fabric.Image.prototype.cacheProperties.concat('perspectiveCoords');

  /**
   * @private
   * @param {CanvasRenderingContext2D} ctx 在畫布上繪製時的 Context
   * 自訂的 render 函式，在繪製前會檢查是否需要應用縮放濾鏡。
   */
  _render(ctx) {
    fabric.util.setImageSmoothing(ctx, this.imageSmoothing);

    // 如果物件沒有在移動，且存在縮放濾鏡，而且需要重新調整大小，則應用縮放濾鏡
    if (this.isMoving !== true && this.resizeFilter && this._needsResize()) {
      this.applyResizeFilters();
    }

    // 繪製邊框（如有設定）
    this._stroke(ctx);
    // 根據定義的繪製順序繪製
    this._renderPaintInOrder(ctx);
  }

  /**
   * @private
   * @param {CanvasRenderingContext2D} ctx
   * 實際將圖片填入的函式，這裡會以 "fit" 的方式將圖片等比縮小後置中繪製。
   */
  _renderFill(ctx) {
    var elementToDraw = this._element;
    if (!elementToDraw) return;

    ctx.save();
    const elWidth = elementToDraw.naturalWidth || elementToDraw.width;
    const elHeight = elementToDraw.naturalHeight || elementToDraw.height;
    const width = this.width;
    const height = this.height;

    // 將繪圖原點移動至物件中心
    ctx.translate(-width / 2, -height / 2);

    // 計算縮放比例，以最小邊適應，達到 "fit" 的效果
    const scale = Math.min(width / elWidth, height / elHeight);
    // 計算繪製時的左上座標，以讓圖片置中顯示
    const x = width / 2 - (elWidth / 2) * scale;
    const y = height / 2 - (elHeight / 2) * scale;

    // 在指定位置以計算好的縮放比例繪製圖片
    ctx.drawImage(elementToDraw, x, y, elWidth * scale, elHeight * scale);

    ctx.restore();
  }

  /**
   * 開關透視模式
   * @param {boolean} mode 是否開啟透視模式
   */
  togglePerspective(mode = true) {
    this.set('layout', 'fit'); // 當啟用透視模式時，將布局設為 fit
    this.perspectiveMode = mode;
    const originalControls = fabric.Image.prototype.controls;

    if (mode === true) {
      this.set('layout', 'fit');

      var lastControl = this.perspectiveCoords.length - 1;

      // 在透視模式下，為每一個透視控制點建立控制器（control）
      this.controls = this.perspectiveCoords.reduce((acc, coord, index) => {
        const anchorIndex = index > 0 ? index - 1 : lastControl;
        let name = `prs${index + 1}`;

        acc[name] = new fabric.Control({
          name,
          x: -0.5,
          y: -0.5,
          // actionHandler 定義當控制點被拖曳時要做的行為
          actionHandler: this._actionWrapper(
            anchorIndex,
            (_, transform, x, y) => {
              const target = transform.target;
              // 計算滑鼠在物件局部座標中的位置
              const localPoint = target.toLocalPoint(
                new fabric.Point(x, y),
                'left',
                'top'
              );

              // 將控制點的坐標更新為局部座標轉換後的結果（並考慮縮放比例）
              coord[0] =
                (localPoint.x / target.scaleX) * fabric.devicePixelRatio;
              coord[1] =
                (localPoint.y / target.scaleY) * fabric.devicePixelRatio;

              target.setCoords(); // 更新物件的控制點
              target.applyFilters(); // 套用透視濾鏡變化

              return true;
            }
          ),
          positionHandler: function (dim, finalMatrix, fabricObject) {
            // 控制點繪製時位置的計算函式
            const zoom = fabricObject.canvas.getZoom();
            const scalarX =
              (fabricObject.scaleX * zoom) / fabric.devicePixelRatio;
            const scalarY =
              (fabricObject.scaleY * zoom) / fabric.devicePixelRatio;

            var point = fabric.util.transformPoint(
              {
                x: this.x * dim.x + this.offsetX + coord[0] * scalarX,
                y: this.y * dim.y + this.offsetY + coord[1] * scalarY,
              },
              finalMatrix
            );

            return point;
          },
          cursorStyleHandler: () => 'cell',
          // 自訂控制點的繪製方式（在控制點間繪出線段，並以綠色小圓點表示控制點）
          render: function (ctx, left, top, _, fabricObject) {
            const zoom = fabricObject.canvas.getZoom();
            const scalarX =
              (fabricObject.scaleX * zoom) / fabric.devicePixelRatio;
            const scalarY =
              (fabricObject.scaleY * zoom) / fabric.devicePixelRatio;

            ctx.save();
            ctx.translate(left, top);
            ctx.rotate(fabric.util.degreesToRadians(fabricObject.angle));
            ctx.beginPath();

            ctx.moveTo(0, 0);
            ctx.strokeStyle = 'green';

            // 將該控制點與下個控制點連成線，若是最後一個點，則連回第一個點
            if (fabricObject.perspectiveCoords[index + 1]) {
              ctx.strokeStyle = 'green';
              ctx.lineTo(
                (fabricObject.perspectiveCoords[index + 1][0] - coord[0]) *
                  scalarX,
                (fabricObject.perspectiveCoords[index + 1][1] - coord[1]) *
                  scalarY
              );
            } else {
              ctx.lineTo(
                (fabricObject.perspectiveCoords[0][0] - coord[0]) * scalarX,
                (fabricObject.perspectiveCoords[0][1] - coord[1]) * scalarY
              );
            }
            ctx.stroke();
            ctx.beginPath();
            ctx.arc(0, 0, 4, 0, Math.PI * 2);
            ctx.closePath();
            ctx.fillStyle = 'green';
            ctx.fill();
            ctx.stroke();
            ctx.restore();
          },
          offsetX: 0,
          offsetY: 0,
          actionName: 'perspective-coords',
        });

        return acc;
      }, {});
    } else {
      // 如果將透視模式關掉，回復原有控制項
      // this.controls = fabric.Photo.prototype.controls;

      this.controls = { ...originalControls };
    }

    this.canvas.requestRenderAll();
  }

  /**
   * _actionWrapper 用於在控制點拖曳開始前、後做一些處理
   * @param {number} anchorIndex 起點的控制點索引
   * @param {function} fn 實際處理更新座標的函式
   */
  _actionWrapper(anchorIndex, fn) {
    return function (eventData, transform, x, y) {
      if (!transform || !eventData) return;

      const { target } = transform;

      // 拖曳前先重置大小和位置
      target._resetSizeAndPosition(anchorIndex);

      // 執行實際更新控制點座標的函式
      const actionPerformed = fn(eventData, transform, x, y);
      return actionPerformed;
    };
  }

  /**
   * @description 在更新控制點後手動重置邊界盒
   * @param {number} index 將更新的控制點索引
   * @param {boolean} apply 是否在重設後應用位移（預設為 true）
   */
  _resetSizeAndPosition = (index, apply = true) => {
    // 將局部的座標點轉換為畫布上的絕對座標點
    const absolutePoint = fabric.util.transformPoint(
      {
        x: this.perspectiveCoords[index][0],
        y: this.perspectiveCoords[index][1],
      },
      this.calcTransformMatrix()
    );

    // 根據目前的所有控制點計算物件的新邊界
    let { height, width, left, top } = this._calcDimensions({});

    // 調整位置，使物件能對齊控制點的變化
    const widthDiff = (width - this.width) / 2;
    if ((left < 0 && widthDiff > 0) || (left > 0 && widthDiff < 0)) {
      absolutePoint.x -= widthDiff;
    } else {
      absolutePoint.x += widthDiff;
    }

    const heightDiff = (height - this.height) / 2;
    if ((top < 0 && heightDiff > 0) || (top > 0 && heightDiff < 0)) {
      absolutePoint.y -= heightDiff;
    } else {
      absolutePoint.y += heightDiff;
    }

    // 將計算結果套用回物件的屬性
    this._setPositionDimensions({});

    // 計算無變形尺寸
    const penBaseSize = this._getNonTransformedDimensions();
    const newX = this.perspectiveCoords[index][0] / penBaseSize.x;
    const newY = this.perspectiveCoords[index][1] / penBaseSize.y;

    // 將物件的定位點設置在該控制點對應的新位置
    this.setPositionByOrigin(absolutePoint, newX + 0.5, newY + 0.5);

    // 若 apply 為 true，則將計算得到的偏移量套用到每個控制點座標上
    apply && this._applyPointsOffset();
  };

  /**
   * @description 計算物件的位置與尺寸。此函式參考自 fabric.Path 的邏輯，
   * 透過 perspectiveCoords 來計算新的 bounding box。
   */
  _setPositionDimensions(options) {
    const { left, top, width, height } = this._calcDimensions(options);

    this.width = width;
    this.height = height;

    var correctLeftTop = this.translateToGivenOrigin(
      {
        x: left,
        y: top,
      },
      'left',
      'top',
      this.originX,
      this.originY
    );

    if (typeof options.left === 'undefined') {
      this.left = correctLeftTop.x;
    }
    if (typeof options.top === 'undefined') {
      this.top = correctLeftTop.y;
    }

    this.pathOffset = {
      x: left,
      y: top,
    };

    return { left, top, width, height };
  }

  /**
   * @description 透過 perspectiveCoords 計算物件的新寬高與位置
   * 這裡會計算四個點的最小、最大 x/y 值，以取得新的 bounding box。
   */
  _calcDimensions() {
    const coords = this.perspectiveCoords.slice().map((c) => ({
      x: c[0] / fabric.devicePixelRatio,
      y: c[1] / fabric.devicePixelRatio,
    }));

    const minX = fabric.util.array.min(coords, 'x') || 0;
    const minY = fabric.util.array.min(coords, 'y') || 0;
    const maxX = fabric.util.array.max(coords, 'x') || 0;
    const maxY = fabric.util.array.max(coords, 'y') || 0;

    const width = Math.abs(maxX - minX);
    const height = Math.abs(maxY - minY);

    return {
      left: minX,
      top: minY,
      width: width,
      height: height,
    };
  }

  /**
   * @description 將計算出的路徑偏移量套用到每個控制點的座標上，
   * 讓控制點的座標以新計算的 pathOffset 為基準。
   */
  _applyPointsOffset() {
    for (let i = 0; i < this.perspectiveCoords.length; i++) {
      const coord = this.perspectiveCoords[i];

      coord[0] -= this.pathOffset.x;
      coord[1] -= this.pathOffset.y;
    }
  }

  /**
   * @description 初始化透視座標
   * 在圖片剛載入時，給定圖片四角的初始透視控制點座標，
   * 並加入一個 Perspective 濾鏡實現透視變化效果。
   */
  getInitialPerspective() {
    let w = this.getScaledWidth();
    let h = this.getScaledHeight();

    // 設定四個角的初始控制點 (無透視扭曲時為矩形的四個角)
    const perspectiveCoords = [
      [0, 0], // 左上
      [w, 0], // 右上
      [w, h], // 右下
      [0, h], // 左下
    ];

    this.perspectiveCoords = perspectiveCoords;

    // 建立透視濾鏡，設定像素比例和控制點座標
    const perspectiveFilter = new fabric.Image.filters.Perspective({
      hasRelativeCoordinates: false,
      pixelRatio: fabric.devicePixelRatio, // the Photo is already retina ready
      perspectiveCoords,
    });

    this.filters.push(perspectiveFilter);
    this.applyFilters();

    return perspectiveCoords;
  }
};

/**
 * @static
 * @description 從 object 的描述中建立 fabric.Photo 實例
 * @param {Object} _object 要還原成 Photo 的物件描述
 * @param {Function} callback 建立完成後的回呼函式
 *
 * 此方法會先嘗試從 object.src 載入圖片，若載入成功，則應用相應的濾鏡與裁切路徑，
 * 最終回呼 callback 傳回一個新的 fabric.Photo 物件實例。
 */
fabric.Photo.fromObject = function (_object, callback) {
  const object = fabric.util.object.clone(_object);
  object.layout = _object.layout;

  // 載入圖片
  fabric.util.loadImage(
    object.src,
    function (img, isError) {
      if (isError) {
        // 若載入失敗，回呼 callback 傳回 null 並標示錯誤
        callback && callback(null, true);
        return;
      }
      // 初始化濾鏡
      fabric.Photo.prototype._initFilters.call(
        object,
        object.filters,
        function (filters) {
          object.filters = filters || [];
          fabric.Photo.prototype._initFilters.call(
            object,
            [object.resizeFilter],
            function (resizeFilters) {
              object.resizeFilter = resizeFilters[0];

              // 若有 clipPath，則還原並實例化
              fabric.util.enlivenObjects(
                [object.clipPath],
                function (enlivedProps) {
                  object.clipPath = enlivedProps[0];
                  // 建立新的 fabric.Photo 實例
                  var image = new fabric.Photo(img, object);
                  callback(image, false);
                }
              );
            }
          );
        }
      );
    },
    null,
    object.crossOrigin || 'anonymous'
  );
};
