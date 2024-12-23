import { fabric } from 'fabric';
import flatten from 'lodash.flatten';
import verb from 'verb-nurbs-web';

/**
 * fabric.Image.filters.Perspective 濾鏡
 *
 * 這個類別為 fabric.Image 的濾鏡擴充功能，實現圖片的透視扭曲效果。
 * 它透過 WebGL 的方式將圖片表面以 NURBS (Non-Uniform Rational B-Spline) 曲面近似，
 * 再運用 Shader 計算對應的貼圖坐標，最終將圖片繪製出來。
 *
 * 使用時機：
 * 當需要在 fabric.Canvas 中顯示一個可自訂四點的圖片，使其呈現出仿 3D 的透視變形效果。
 */
fabric.Image.filters.Perspective = class extends (
  fabric.Image.filters.BaseFilter
) {
  /**
   * 建構子 (Constructor)
   * @param {Object} [options] 選項物件，包括是否相對座標，透視點座標、pixelRatio 等
   */
  constructor(options) {
    super();

    if (options) this.setOptions(options);

    // 根據目前裝置像素比率對座標進行轉換
    this.applyPixelRatio();
  }

  // 濾鏡類型的名稱
  type = 'Perspective';
  // pixelRatio 用於高解析度（retina）顯示的比例調整
  pixelRatio = fabric.devicePixelRatio;
  // bounds 用於記錄透視後的邊界資訊
  bounds = { width: 0, height: 0, minX: 0, maxX: 0, minY: 0, maxY: 0 };
  // 是否使用相對座標（若為 true，會根據計算後的最小 x, y 做平移）
  hasRelativeCoordinates = true;

  /**
   * Shader 程式中頂點著色器 (vertex shader) 原始碼
   * aPosition：頂點位置
   * aUvs：紋理座標 (UV mapping)
   *
   * 在此會將輸入的座標值轉換為映射到 WebGL clip space (-1, 1) 的值，
   * 並將 UV 座標傳遞至 fragment shader。
   */
  vertexSource = `
        precision mediump float;

        attribute vec2 aPosition;
        attribute vec2 aUvs;

        uniform float uStepW;
        uniform float uStepH;

        varying vec2 vUvs;

        vec2 uResolution;

        void main() {
            vUvs = aUvs;
            uResolution = vec2(uStepW, uStepH);

            gl_Position = vec4(uResolution * aPosition * 2.0 - 1.0, 0.0, 1.0);
        }
    `;

  /**
   * Shader 程式中片段著色器 (fragment shader) 原始碼
   * vUvs：從頂點著色器傳來的 UV 座標
   * uSampler：紋理取樣器
   *
   * 這裡會使用 texture2D 以 UV 座標對原始圖片進行取樣，並輸出顏色值。
   */
  fragmentSource = `
        precision mediump float;
        varying vec2 vUvs;
        uniform sampler2D uSampler;

        void main() {
            gl_FragColor = texture2D(uSampler, vUvs);
        }
    `;

  /**
   * 取得 Shader 中屬性的位置信息（attributeLocations）
   * @param {WebGLRenderingContext} gl WebGL 上下文
   * @param {WebGLShaderProgram} program 已編譯好的 Shader 程式
   * @return {Object} 返回包含 attribute 名稱和位置的物件
   */
  getAttributeLocations(gl, program) {
    return {
      aPosition: gl.getAttribLocation(program, 'aPosition'),
      aUvs: gl.getAttribLocation(program, 'aUvs'),
    };
  }

  /**
   * 將資料傳給 Shader 的 attribute
   * @param {WebGLRenderingContext} gl WebGL 上下文
   * @param {Object} attributeLocations 上一步取得的 attribute 位置信息
   * @param {Float32Array} data 要傳入的頂點或 UV 資料
   * @param {string} type 預設為 'aPosition' 或 'aUvs'
   */
  sendAttributeData(gl, attributeLocations, data, type = 'aPosition') {
    const attributeLocation = attributeLocations[type];
    if (gl[type + 'vertexBuffer'] == null) {
      gl[type + 'vertexBuffer'] = gl.createBuffer();
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, gl[type + 'vertexBuffer']);
    gl.enableVertexAttribArray(attributeLocation);
    gl.vertexAttribPointer(attributeLocation, 2, gl.FLOAT, false, 0, 0);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
  }

  /**
   * 使用 verb-nurbs-web 產生一個 NURBS 曲面 (NurbsSurface)，
   * 再由 tessellate() 將曲面離散化成對應的 polygon mesh (點與面)
   * @return {Object} tessellation 結果，含有 points、faces、uvs 等資料
   */
  generateSurface() {
    const corners = this.perspectiveCoords;
    // 由四個角定義一個 NURBS 曲面
    const surface = verb.geom.NurbsSurface.byCorners(...corners);
    // 將曲面網格化 (tessellate)
    const tess = surface.tessellate();

    return tess;
  }

  /**
   * 濾鏡應用的主要入口，當使用 WebGL 時會呼叫此方法
   * @param {Object} options
   * @param {boolean} options.webgl 是否使用 webgl
   * @param {WebGLRenderingContext} options.context WebGL Context
   * ... 其他參數如 sourceTexture, targetTexture, width, height...
   */
  /**
   * Apply the resize filter to the image
   * Determines whether to use WebGL or Canvas2D based on the options.webgl flag.
   *
   * @param {Object} options
   * @param {Number} options.passes The number of filters remaining to be executed
   * @param {Boolean} options.webgl Whether to use webgl to render the filter.
   * @param {WebGLTexture} options.sourceTexture The texture setup as the source to be filtered.
   * @param {WebGLTexture} options.targetTexture The texture where filtered output should be drawn.
   * @param {WebGLRenderingContext} options.context The GL context used for rendering.
   * @param {Object} options.programCache A map of compiled shader programs, keyed by filter type.
   */
  applyTo(options) {
    if (options.webgl) {
      const { width, height } = this.getPerspectiveBounds();

      // 根據計算後的 bounds 設定繪製大小
      options.context.canvas.width = width;
      options.context.canvas.height = height;
      options.destinationWidth = width;
      options.destinationHeight = height;

      // 若使用相對座標則重新計算座標位置，使其從(0,0)開始
      this.hasRelativeCoordinates && this.calculateCoordsByCorners();

      // 設定 framebuffer，準備開始繪製
      this._setupFrameBuffer(options);
      // 使用 WebGL 方式將透視濾鏡應用到紋理上
      this.applyToWebGL(options);
      // 交換 source/target texture 以連續套用濾鏡
      this._swapTextures(options);
    }
  }

  /**
   * 根據 pixelRatio 將座標進行縮放，適用於 Retina 顯示器
   * @param {number[][]} coords 預設使用 this.perspectiveCoords
   */
  applyPixelRatio(coords = this.perspectiveCoords) {
    for (let i = 0; i < coords.length; i++) {
      coords[i][0] *= this.pixelRatio;
      coords[i][1] *= this.pixelRatio;
    }

    return coords;
  }

  /**
   * 計算透視後的邊界，並儲存在 this.bounds 中
   * @param {number[][]} coords 預設使用 this.perspectiveCoords
   * @return {Object} 返回包含寬高及 minX, maxX, minY, maxY 的物件
   */
  getPerspectiveBounds(coords = this.perspectiveCoords) {
    coords = this.perspectiveCoords.slice().map((c) => ({
      x: c[0],
      y: c[1],
    }));

    this.bounds.minX = fabric.util.array.min(coords, 'x') || 0;
    this.bounds.minY = fabric.util.array.min(coords, 'y') || 0;
    this.bounds.maxX = fabric.util.array.max(coords, 'x') || 0;
    this.bounds.maxY = fabric.util.array.max(coords, 'y') || 0;

    this.bounds.width = Math.abs(this.bounds.maxX - this.bounds.minX);
    this.bounds.height = Math.abs(this.bounds.maxY - this.bounds.minY);

    return {
      width: this.bounds.width,
      height: this.bounds.height,
      minX: this.bounds.minX,
      maxX: this.bounds.maxX,
      minY: this.bounds.minY,
      maxY: this.bounds.maxY,
    };
  }

  /**
   * 若使用相對座標，則將計算得到的邊界最小點當成 (0,0) 起點，
   * 將所有座標平移，使之從最小值開始計算。
   */
  calculateCoordsByCorners(coords = this.perspectiveCoords) {
    for (let i = 0; i < coords.length; i++) {
      coords[i][0] -= this.bounds.minX;
      coords[i][1] -= this.bounds.minY;
    }
  }

  /**
   * 使用 WebGL 在畫面上應用濾鏡
   * @param {Object} options
   * @param {WebGLRenderingContext} options.context WebGL context
   */
  /**
   * Apply this filter using webgl.
   *
   * @param {Object} options
   * @param {Number} options.passes The number of filters remaining to be executed
   * @param {Boolean} options.webgl Whether to use webgl to render the filter.
   * @param {WebGLTexture} options.originalTexture The texture of the original input image.
   * @param {WebGLTexture} options.sourceTexture The texture setup as the source to be filtered.
   * @param {WebGLTexture} options.targetTexture The texture where filtered output should be drawn.
   * @param {WebGLRenderingContext} options.context The GL context used for rendering.
   * @param {Object} options.programCache A map of compiled shader programs, keyed by filter type.
   */
  applyToWebGL(options) {
    const gl = options.context;
    const shader = this.retrieveShader(options); // 載入或建立 Shader
    const tess = this.generateSurface(
      options.sourceWidth,
      options.sourceHeight
    );
    const indices = new Uint16Array(flatten(tess.faces));

    // 清空畫布
    this.clear(gl);

    // 綁定紋理
    this.bindTexture(gl, options);

    gl.useProgram(shader.program);

    // 建立並設定索引緩衝（elements array buffer）
    this.indexBuffer(gl, indices);

    // 將頂點位置資料傳給 Shader
    this.sendAttributeData(
      gl,
      shader.attributeLocations,
      new Float32Array(flatten(tess.points)),
      'aPosition'
    );
    // 將 UV 資料傳給 Shader
    this.sendAttributeData(
      gl,
      shader.attributeLocations,
      new Float32Array(flatten(tess.uvs)),
      'aUvs'
    );

    gl.uniform1f(shader.uniformLocations.uStepW, 1 / gl.canvas.width);
    gl.uniform1f(shader.uniformLocations.uStepH, 1 / gl.canvas.height);

    // 傳送其他 Uniform 資料（若需要）
    this.sendUniformData(gl, shader.uniformLocations);
    gl.viewport(0, 0, options.destinationWidth, options.destinationHeight);

    // 啟用較大索引支援
    gl.getExtension('OES_element_index_uint');
    // 繪製元素（網格）
    gl.drawElements(gl.TRIANGLES, indices.length, gl.UNSIGNED_SHORT, 0);
  }

  /**
   * 清空 WebGL 畫面
   */
  clear(gl) {
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  }

  /**
   * 將紋理（圖片）與當前 context 綁定，以進行取樣與繪製
   */
  bindTexture(gl, options) {
    if (options.pass === 0 && options.originalTexture) {
      gl.bindTexture(gl.TEXTURE_2D, options.originalTexture);
    } else {
      gl.bindTexture(gl.TEXTURE_2D, options.sourceTexture);
    }

    // 設定紋理參數，避免邊界出現怪異像素 (CLAMP_TO_EDGE) 並使用線性插值
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  /**
   * 建立並綁定索引緩衝（Element Array Buffer）
   * indices 用於定義網格中三角形的連結方式
   */
  indexBuffer(gl, data) {
    const indexBuffer = gl.createBuffer();
    // make this buffer the current 'ELEMENT_ARRAY_BUFFER'
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
    // Fill the current element array buffer with data
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, data, gl.STATIC_DRAW);
  }
};

/**
 * 從 object 中還原 filter 實例
 * @static
 * @param {Object} object 用於產生濾鏡實例的描述物件
 * @param {function} [callback] 建立完成後的回呼函式
 * @return {fabric.Image.filters.Perspective} 回傳產生的 Perspective 濾鏡實例
 */
fabric.Image.filters.Perspective.fromObject =
  fabric.Image.filters.BaseFilter.fromObject;
