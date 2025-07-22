import * as THREE from "three";
import { gsap } from "gsap";
import { GUI } from "lil-gui";
import vertexShader from "./shaders/vertex.glsl";
import fragmentShader from "./shaders/fragment.glsl";

// GSAPの性能向上のための設定
gsap.config({
  force3D: true,
  nullTargetWarn: false,
});

class Slider {
  constructor(options = {}) {
    this.options = {
      container: ".js-slider",
      bulletSelector: ".js-slider-bullet",
      intensity: 0.5,
      duration: 2.5,
      ...options,
    };

    this.bindAll();
    this.initElements();
    this.initData();
    this.init();
  }

  initElements() {
    this.el = document.querySelector(this.options.container);
    if (!this.el) {
      throw new Error(`Slider container "${this.options.container}" not found`);
    }

    this.inner = this.el.querySelector(".js-slider__inner");
    this.bullets = [...this.el.querySelectorAll(this.options.bulletSelector)];
  }

  initData() {
    this.images = ["/images/bg1.jpg", "/images/bg2.jpg", "/images/bg3.jpg"];

    this.data = {
      current: 0,
      next: 1,
      total: this.images.length - 1,
      delta: 0,
    };

    this.state = {
      animating: false,
      text: false,
      initial: true,
    };

    this.renderer = null;
    this.scene = null;
    this.clock = null;
    this.camera = null;
    this.textures = null;
    this.mat = null;
    this.disp = null;
    this.gui = null;

    // GUIコントロール用のパラメータ
    this.guiParams = {
      dispPower: 0.0,
      intensity: this.options.intensity,
      autoTransition: true,
    };

    // ホイールイベントのスロットリング
    this.lastWheelTime = 0;
    this.wheelThreshold = 800; // ホイールイベント間の間隔（800ms）
  }

  bindAll() {
    [
      "render",
      "nextSlide",
      "handleResize",
      "handleKeydown",
      "handleWheel",
    ].forEach((fn) => (this[fn] = this[fn].bind(this)));
  }

  setupGUI() {
    this.gui = new GUI();
    this.gui.title("Displacement Slider Controls");

    // dispPowerコントロール
    this.gui
      .add(this.guiParams, "dispPower", 0, 1, 0.01)
      .name("Displacement Power")
      .onChange((value) => {
        if (this.mat) {
          this.mat.uniforms.dispPower.value = value;
          this.render();
        }
      });

    // intensityコントロール
    this.gui
      .add(this.guiParams, "intensity", 0, 2, 0.1)
      .name("Intensity")
      .onChange((value) => {
        if (this.mat) {
          this.mat.uniforms.intensity.value = value;
          this.render();
        }
      });

    // 自動トランジションの有効/無効
    this.gui
      .add(this.guiParams, "autoTransition")
      .name("Auto Transition")
      .onChange((value) => {
        // この値は他のメソッドで参照される
      });

    // 手動でトランジションを実行するボタン
    this.gui
      .add(
        {
          triggerTransition: () => {
            if (!this.state.animating) {
              this.nextSlide();
            }
          },
        },
        "triggerTransition"
      )
      .name("Trigger Transition");

    // dispPowerを0にリセットするボタン
    this.gui
      .add(
        {
          resetDispPower: () => {
            this.guiParams.dispPower = 0;
            if (this.mat) {
              this.mat.uniforms.dispPower.value = 0;
              this.render();
            }
            // GUIの表示も更新
            this.gui.controllers.forEach((controller) => {
              if (controller.property === "dispPower") {
                controller.updateDisplay();
              }
            });
          },
        },
        "resetDispPower"
      )
      .name("Reset Displacement");

    // フォルダーを作成してテクスチャ情報を表示
    const infoFolder = this.gui.addFolder("Info");
    infoFolder
      .add({ currentSlide: 0 }, "currentSlide")
      .name("Current Slide")
      .listen();
    infoFolder.add({ nextSlide: 1 }, "nextSlide").name("Next Slide").listen();

    // リアルタイムでスライド情報を更新
    this.updateGUIInfo = () => {
      infoFolder.controllers.forEach((controller) => {
        if (controller.property === "currentSlide") {
          controller.object.currentSlide = this.data.current;
        }
        if (controller.property === "nextSlide") {
          controller.object.nextSlide = this.data.next;
        }
        controller.updateDisplay();
      });
    };
  }

  setStyles() {
    // 弾丸ナビゲーションのスタイルを初期化
    this.bullets.forEach((bullet, index) => {
      const txt = bullet.querySelector(".js-slider-bullet__text");
      const line = bullet.querySelector(".js-slider-bullet__line");

      if (index === 0) {
        gsap.set(txt, { opacity: 1 });
        gsap.set(line, { scaleX: 1, transformOrigin: "left" });
      } else {
        gsap.set(txt, { opacity: 0.25 });
        gsap.set(line, { scaleX: 0, transformOrigin: "left" });
      }
    });
  }

  cameraSetup() {
    this.camera = new THREE.OrthographicCamera(
      this.el.offsetWidth / -2,
      this.el.offsetWidth / 2,
      this.el.offsetHeight / 2,
      this.el.offsetHeight / -2,
      1,
      1000
    );
    this.camera.lookAt(this.scene.position);
    this.camera.position.z = 1;
  }

  setup() {
    this.scene = new THREE.Scene();
    this.clock = new THREE.Clock(true);
    this.renderer = new THREE.WebGLRenderer({
      alpha: true,
    });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setSize(this.el.offsetWidth, this.el.offsetHeight);
    this.inner.appendChild(this.renderer.domElement);
  }

  async loadTextures() {
    const loader = new THREE.TextureLoader();
    loader.crossOrigin = "";

    try {
      // ディスプレイスメントテクスチャを読み込み
      this.disp = await new Promise((resolve, reject) => {
        loader.load(
          "https://s3-us-west-2.amazonaws.com/s.cdpn.io/58281/rock-_disp.png",
          resolve,
          undefined,
          reject
        );
      });
      this.disp.magFilter = this.disp.minFilter = THREE.LinearFilter;
      this.disp.wrapS = this.disp.wrapT = THREE.RepeatWrapping;

      // 画像テクスチャを読み込み
      this.textures = await Promise.all(
        this.images.map(
          (image, index) =>
            new Promise((resolve, reject) => {
              const texture = loader.load(
                `${image}?v=${Date.now()}`,
                (loadedTexture) => {
                  loadedTexture.minFilter = THREE.LinearFilter;
                  loadedTexture.generateMipmaps = false;
                  resolve(loadedTexture);
                },
                undefined,
                reject
              );
            })
        )
      );

      this.render();
    } catch (error) {
      console.error("Error loading textures:", error);
    }
  }

  createMesh() {
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        dispPower: { value: this.guiParams.dispPower },
        intensity: { value: this.guiParams.intensity },
        res: {
          value: new THREE.Vector2(window.innerWidth, window.innerHeight),
        },
        size: { value: new THREE.Vector2(1, 1) },
        texture1: { value: this.textures[0] },
        texture2: { value: this.textures[1] },
        disp: { value: this.disp },
      },
      transparent: true,
      vertexShader: vertexShader,
      fragmentShader: fragmentShader,
    });
    const geometry = new THREE.PlaneGeometry(
      this.el.offsetWidth,
      this.el.offsetHeight,
      1
    );
    const mesh = new THREE.Mesh(geometry, this.mat);
    this.scene.add(mesh);
  }

  transition() {
    // 自動トランジションが無効の場合は実行しない
    if (!this.guiParams.autoTransition) {
      console.log("Auto transition is disabled");
      return;
    }

    console.log("Transition starting:", {
      current: this.data.current,
      next: this.data.next,
      animating: this.state.animating,
    });

    // WebGLトランジション
    gsap.to(this.mat.uniforms.dispPower, {
      duration: this.options.duration,
      value: 1,
      ease: "expo.inOut",
      onUpdate: () => {
        // GUIパラメータも同期
        this.guiParams.dispPower = this.mat.uniforms.dispPower.value;
        this.gui.controllers.forEach((controller) => {
          if (controller.property === "dispPower") {
            controller.updateDisplay();
          }
        });
        this.render();
      },
      onComplete: () => {
        this.mat.uniforms.dispPower.value = 0.0;
        this.guiParams.dispPower = 0.0;

        // GUIの表示を更新
        this.gui.controllers.forEach((controller) => {
          if (controller.property === "dispPower") {
            controller.updateDisplay();
          }
        });

        this.changeTexture();
        this.state.animating = false;

        // GUI情報を更新
        if (this.updateGUIInfo) {
          this.updateGUIInfo();
        }

        console.log("Transition completed, animating set to false");
      },
    });

    // 弾丸ナビゲーションを更新
    this.updateBullets();
  }

  updateBullets() {
    this.bullets.forEach((bullet, index) => {
      const txt = bullet.querySelector(".js-slider-bullet__text");
      const line = bullet.querySelector(".js-slider-bullet__line");

      if (index === this.data.current) {
        // アクティブな弾丸
        gsap.to(txt, { duration: 0.3, opacity: 1, ease: "power2.out" });
        gsap.to(line, { duration: 0.3, scaleX: 1, ease: "power2.out" });
      } else {
        // 非アクティブな弾丸
        gsap.to(txt, { duration: 0.3, opacity: 0.25, ease: "power2.out" });
        gsap.to(line, { duration: 0.3, scaleX: 0, ease: "power2.out" });
      }
    });
  }

  nextSlide() {
    if (this.state.animating) return;

    console.log("Next slide - before:", {
      current: this.data.current,
      next: this.data.next,
      total: this.data.total,
    });

    this.state.animating = true;

    // 次のスライドのデータを更新
    this.data.current =
      this.data.current === this.data.total ? 0 : this.data.current + 1;
    this.data.next =
      this.data.current === this.data.total ? 0 : this.data.current + 1;

    console.log("Next slide - after:", {
      current: this.data.current,
      next: this.data.next,
    });

    this.transition();
  }

  changeTexture() {
    // texture1: 現在表示中の画像のテクスチャ
    // texture2: 次に表示する画像のテクスチャ
    this.mat.uniforms.texture1.value = this.textures[this.data.current];
    this.mat.uniforms.texture2.value = this.textures[this.data.next];

    // コンソールで確認
    console.log("texture1 (current):", this.textures[this.data.current]);
    console.log("texture2 (next):", this.textures[this.data.next]);
  }

  listeners() {
    console.log("Setting up event listeners...");

    // ホイールナビゲーション
    window.addEventListener("wheel", this.handleWheel, {
      passive: false,
    });
    console.log("Wheel event listener added");

    // キーボードナビゲーション
    window.addEventListener("keydown", this.handleKeydown, {
      passive: true,
    });

    // リサイズ処理
    window.addEventListener("resize", this.handleResize, {
      passive: true,
    });
  }

  handleWheel(e) {
    e.preventDefault();

    const now = Date.now();

    // ホイールイベントをスロットリング
    if (now - this.lastWheelTime < this.wheelThreshold) {
      return;
    }

    // アニメーション中かどうかをチェック
    if (this.state.animating) {
      return;
    }

    // ホイールデルタの閾値をチェック
    if (Math.abs(e.deltaY) > 10) {
      this.lastWheelTime = now;

      console.log("Next slide triggered by wheel");
      this.nextSlide();
    }
  }

  handleKeydown(e) {
    switch (e.key) {
      case "ArrowRight":
      case "ArrowLeft":
      case " ":
        e.preventDefault();
        this.nextSlide();
        break;
      case "Home":
        e.preventDefault();
        this.goToSlide(0);
        break;
      case "End":
        e.preventDefault();
        this.goToSlide(this.data.total);
        break;
    }
  }

  goToSlide(index) {
    if (this.state.animating || index === this.data.current) return;

    this.data.next = index;
    this.nextSlide();
  }

  handleResize() {
    if (!this.renderer || !this.camera) return;

    const width = this.el.offsetWidth;
    const height = this.el.offsetHeight;

    this.renderer.setSize(width, height);
    this.camera.left = width / -2;
    this.camera.right = width / 2;
    this.camera.top = height / 2;
    this.camera.bottom = height / -2;
    this.camera.updateProjectionMatrix();

    if (this.mat) {
      this.mat.uniforms.res.value.set(window.innerWidth, window.innerHeight);
    }

    this.render();
  }

  dispose() {
    // GUIを破棄
    if (this.gui) {
      this.gui.destroy();
    }

    // イベントリスナーを削除
    window.removeEventListener("wheel", this.handleWheel);
    window.removeEventListener("keydown", this.handleKeydown);
    window.removeEventListener("resize", this.handleResize);

    // WebGLリソースを破棄
    if (this.renderer) {
      this.renderer.dispose();
    }

    if (this.textures) {
      this.textures.forEach((texture) => texture.dispose());
    }

    if (this.disp) {
      this.disp.dispose();
    }

    if (this.mat) {
      this.mat.dispose();
    }

    // すべてのGSAPアニメーションを停止
    gsap.killTweensOf(this.mat?.uniforms?.dispPower);
    gsap.killTweensOf(this.slides);
    gsap.killTweensOf(this.bullets);
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }

  async init() {
    this.setup();
    this.cameraSetup();
    await this.loadTextures();
    this.createMesh();
    this.setStyles();
    this.setupGUI(); // GUIを初期化
    this.render();
    this.listeners();
  }
}

class Navigation {
  constructor(slider = null) {
    this.slider = slider;
    this.init();
  }

  init() {
    // スライダーが提供されている場合、弾丸ナビゲーションを追加
    if (this.slider) {
      const bullets = document.querySelectorAll(".js-slider-bullet");
      bullets.forEach((bullet, index) => {
        bullet.addEventListener("click", () => {
          this.slider.goToSlide(index);
        });

        // カーソルポインタースタイルを追加
        bullet.style.cursor = "pointer";
      });
    }
  }

  dispose() {
    if (this.slider) {
      const bullets = document.querySelectorAll(".js-slider-bullet");
      bullets.forEach((bullet) => {
        bullet.removeEventListener("click", this.handleBulletClick);
      });
    }
  }
}

//アプリケーションを初期化
async function initApp() {
  try {
    const slider = new Slider({
      // カスタムオプションをここに設定可能
      intensity: 0.6,
      duration: 2.0,
    });

    const navigation = new Navigation(slider);

    // デバッグ用にグローバルスコープに公開（オプション）
    if (typeof window !== "undefined") {
      window.slider = slider;
      window.navigation = navigation;
    }

    return { slider, navigation };
  } catch (error) {
    console.error("Failed to initialize application:", error);
  }
}

// DOMの準備ができたら自動初期化
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initApp);
} else {
  initApp();
}
