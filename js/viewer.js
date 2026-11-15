/* 3D-просмотрщик органов: загрузка сеток, камера, подписи-выноски, выделение. */
(function () {
  "use strict";
  const T = window.THREE;
  const ACCENT = new T.Color("#5eead4");

  function b64ToBuffer(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out.buffer;
  }

  const loading = {};
  function loadData(id) {
    if (window.ANATOMY_DATA && window.ANATOMY_DATA[id]) return Promise.resolve(window.ANATOMY_DATA[id]);
    if (!loading[id]) {
      loading[id] = new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.src = "data/" + id + ".js";
        s.onload = () => resolve(window.ANATOMY_DATA[id]);
        s.onerror = () => reject(new Error("data " + id));
        document.head.appendChild(s);
      });
    }
    return loading[id];
  }

  const v3 = (x, y, z) => new T.Vector3(x, y, z);

  function centroid(pos) {
    const c = v3(0, 0, 0);
    const n = pos.length / 3;
    for (let i = 0; i < pos.length; i += 3) { c.x += pos[i]; c.y += pos[i + 1]; c.z += pos[i + 2]; }
    return c.multiplyScalar(1 / n);
  }
  function extreme(posList, origin, dir) {
    let best = -Infinity; const out = v3(0, 0, 0);
    for (const pos of posList) {
      for (let i = 0; i < pos.length; i += 3) {
        const d = (pos[i] - origin.x) * dir.x + (pos[i + 1] - origin.y) * dir.y + (pos[i + 2] - origin.z) * dir.z;
        if (d > best) { best = d; out.set(pos[i], pos[i + 1], pos[i + 2]); }
      }
    }
    return out;
  }
  function nearest(posList, p) {
    let best = Infinity; const out = v3(0, 0, 0);
    for (const pos of posList) {
      for (let i = 0; i < pos.length; i += 3) {
        const dx = pos[i] - p.x, dy = pos[i + 1] - p.y, dz = pos[i + 2] - p.z;
        const d = dx * dx + dy * dy + dz * dz;
        if (d < best) { best = d; out.set(pos[i], pos[i + 1], pos[i + 2]); }
      }
    }
    return out;
  }
  function extentAlong(pos, origin, dir) {
    let mn = Infinity, mx = -Infinity;
    for (let i = 0; i < pos.length; i += 3) {
      const d = (pos[i] - origin.x) * dir.x + (pos[i + 1] - origin.y) * dir.y + (pos[i + 2] - origin.z) * dir.z;
      if (d < mn) mn = d; if (d > mx) mx = d;
    }
    return [mn, mx];
  }
  function principalAxis(pos, c) {
    const m = [0, 0, 0, 0, 0, 0];
    for (let i = 0; i < pos.length; i += 3) {
      const x = pos[i] - c.x, y = pos[i + 1] - c.y, z = pos[i + 2] - c.z;
      m[0] += x * x; m[1] += x * y; m[2] += x * z; m[3] += y * y; m[4] += y * z; m[5] += z * z;
    }
    let a = v3(0.2, 1, 0.1).normalize();
    for (let k = 0; k < 40; k++) {
      a = v3(m[0] * a.x + m[1] * a.y + m[2] * a.z, m[1] * a.x + m[3] * a.y + m[4] * a.z, m[2] * a.x + m[4] * a.y + m[5] * a.z).normalize();
    }
    return a;
  }
  function tube(points, radius, seg) {
    const curve = new T.CatmullRomCurve3(points, false, "centripetal");
    return new T.TubeGeometry(curve, seg || Math.max(16, points.length * 10), radius, 10, false);
  }
  function merge(geoms) {
    let nv = 0, ni = 0;
    geoms.forEach(g => { nv += g.attributes.position.count; ni += g.index.count; });
    const pos = new Float32Array(nv * 3), idx = new Uint32Array(ni);
    let vo = 0, io = 0;
    geoms.forEach(g => {
      pos.set(g.attributes.position.array, vo * 3);
      const gi = g.index.array;
      for (let i = 0; i < gi.length; i++) idx[io + i] = gi[i] + vo;
      vo += g.attributes.position.count; io += gi.length;
    });
    const out = new T.BufferGeometry();
    out.setAttribute("position", new T.BufferAttribute(pos, 3));
    out.setIndex(new T.BufferAttribute(idx, 1));
    out.computeVertexNormals();
    return out;
  }
  function placed(geom, position, alongDir, scale) {
    const g = geom.index ? geom : geom.toNonIndexed();
    const q = new T.Quaternion().setFromUnitVectors(v3(0, 1, 0), alongDir.clone().normalize());
    const m = new T.Matrix4().compose(position, q, scale || v3(1, 1, 1));
    g.applyMatrix4(m);
    return g;
  }

  /* ---------- процедурные дополнения ---------- */
  const SETUPS = {
    heart(ctx) {
      const mm = ctx.mm, P = ctx.pos;
      const Tc = centroid(P.tricuspid), Mc = centroid(P.mitral), Pv = centroid(P.pulmvalve);
      const B = Tc.clone().add(Mc).multiplyScalar(0.5);
      const A = extreme([P.wall], B, v3(0.55, -0.7, 0.45).normalize());
      const a = A.clone().sub(B); const len = a.length(); a.normalize();
      let s = Mc.clone().sub(Tc); s.addScaledVector(a, -s.dot(a)).normalize();
      const at = (base, da, ds, extra) => { const p = base.clone().addScaledVector(a, da * mm).addScaledVector(s, ds * mm); if (extra) p.add(extra.clone().multiplyScalar(mm)); return p; };
      const pts = ctx.points;
      pts.apex = A;
      pts.ra = at(Tc, -24, -6);
      pts.la = at(Mc, -22, 6);
      pts.rv = Tc.clone().lerp(A, 0.48).addScaledVector(s, -10 * mm);
      pts.lv = Mc.clone().lerp(A, 0.5).addScaledVector(s, 8 * mm);
      pts.septum = B.clone().lerp(A, 0.5);
      pts.aorticvalve = nearest([P.aorta], B);
      // проводящая система (схема)
      const svcLow = extreme([P.svc], centroid(P.svc), v3(0, -1, 0));
      const sa = svcLow.clone().lerp(pts.ra, 0.18);
      const av = at(B, -7, -5);
      const his = at(B, 7, -1);
      const sep = t => B.clone().lerp(A, t);
      const rEnd = Tc.clone().lerp(A, 0.52).addScaledVector(s, -27 * mm);
      const lEndA = Mc.clone().lerp(A, 0.55).addScaledVector(s, 27 * mm).add(v3(0, 0, 12 * mm));
      const lEndP = Mc.clone().lerp(A, 0.55).addScaledVector(s, 25 * mm).add(v3(0, 0, -14 * mm));
      const r = 1.1 * mm;
      const tracts = [
        tube([sa, sa.clone().lerp(av, 0.5).addScaledVector(s, -12 * mm), av], r * 0.8),
        tube([sa, sa.clone().lerp(av, 0.45).addScaledVector(s, 9 * mm), av], r * 0.8),
        tube([sa, sa.clone().lerp(pts.la, 0.6).addScaledVector(a, -8 * mm), pts.la.clone().addScaledVector(a, -4 * mm)], r * 0.7),
      ];
      const hisG = tube([av, at(B, 0, -3), his], r * 1.5);
      const rbb = tube([his, sep(0.3).addScaledVector(s, -5 * mm), sep(0.6).addScaledVector(s, -6 * mm), sep(0.84).addScaledVector(s, -7 * mm), A.clone().lerp(rEnd, 0.55).addScaledVector(s, -4 * mm), rEnd], r * 1.2);
      const lbb = tube([his, sep(0.22).addScaledVector(s, 5 * mm), sep(0.4).addScaledVector(s, 6 * mm)], r * 1.3);
      const lf1 = tube([sep(0.4).addScaledVector(s, 6 * mm), sep(0.66).addScaledVector(s, 7 * mm).add(v3(0, 0, 6 * mm)), sep(0.88).addScaledVector(s, 9 * mm), A.clone().lerp(lEndA, 0.6), lEndA], r);
      const lf2 = tube([sep(0.4).addScaledVector(s, 6 * mm), sep(0.6).addScaledVector(s, 9 * mm).add(v3(0, 0, -8 * mm)), sep(0.8).addScaledVector(s, 14 * mm).add(v3(0, 0, -10 * mm)), lEndP], r);
      const purk = [];
      const twig = (from, to, bend) => purk.push(tube([from, from.clone().lerp(to, 0.5).add(bend.clone().multiplyScalar(mm)), to], r * 0.55, 12));
      twig(rEnd, rEnd.clone().addScaledVector(a, -26 * mm).addScaledVector(s, -3 * mm), v3(0, 0, 4));
      twig(rEnd, rEnd.clone().addScaledVector(a, -9 * mm).add(v3(0, 0, 10 * mm)), v3(0, 0, 2));
      twig(lEndA, lEndA.clone().addScaledVector(a, -28 * mm).addScaledVector(s, 3 * mm), v3(0, 0, 4));
      twig(lEndA, lEndA.clone().addScaledVector(a, -8 * mm).add(v3(0, 0, -9 * mm)), v3(0, 0, 0));
      twig(lEndP, lEndP.clone().addScaledVector(a, -26 * mm).addScaledVector(s, 3 * mm), v3(0, 0, -4));
      const node = (p, rad) => { const g = new T.SphereGeometry(rad * mm, 20, 14); g.translate(p.x, p.y, p.z); return g; };
      const glow = { color: "#bff7ee", emissive: "#2dd4bf", emissiveIntensity: 0.9, glow: true };
      ctx.addMesh("c_sa", merge([node(sa, 3.6)]), { color: "#fde68a", emissive: "#f59e0b", emissiveIntensity: 0.8, glow: true });
      ctx.addMesh("c_av", merge([node(av, 3.2)]), { color: "#fde68a", emissive: "#f59e0b", emissiveIntensity: 0.8, glow: true });
      ctx.addMesh("c_tracts", merge(tracts), glow);
      ctx.addMesh("c_his", merge([hisG]), glow);
      ctx.addMesh("c_rbb", merge([rbb]), glow);
      ctx.addMesh("c_lbb", merge([lbb, lf1, lf2]), glow);
      ctx.addMesh("c_purk", merge(purk), glow);
      pts.sa = sa; pts.av = av; pts.his = at(B, 2, -2);
      pts.rbb = sep(0.6).addScaledVector(s, -6 * mm);
      pts.lbb = sep(0.3).addScaledVector(s, 5.5 * mm);
      pts.purk = lEndA;
      void Pv;
    },

    lungs(ctx) {
      const P = ctx.pos, mm = ctx.mm, pts = ctx.points;
      const tc = centroid(P.trachea);
      const low = extreme([P.trachea], tc, v3(0, -1, 0));
      pts.carina = low;
      pts.bronchR = nearest([P.bronchi], low.clone().add(v3(-24 * mm, -14 * mm, 0)));
      pts.bronchL = nearest([P.bronchi], low.clone().add(v3(30 * mm, -18 * mm, 0)));
      pts.segR = nearest([P.bronchi], low.clone().add(v3(-62 * mm, -70 * mm, -10 * mm)));
      pts.hilumL = nearest([P.pulmveins], low.clone().add(v3(42 * mm, -40 * mm, 0)));
      pts.trunk = nearest([P.pulmartery], low.clone().add(v3(8 * mm, -45 * mm, 30 * mm)));
    },

    kidneys(ctx) {
      const P = ctx.pos, mm = ctx.mm, pts = ctx.points;
      const pyr = [], cal = [];
      ["l", "r"].forEach(side => {
        const kp = P[side + "_kidney"];
        const c = centroid(kp);
        let u = principalAxis(kp, c); if (u.y < 0) u.multiplyScalar(-1);
        let h = v3(side === "l" ? -1 : 1, 0, 0.25); h.addScaledVector(u, -h.dot(u)).normalize();
        const eu = extentAlong(kp, c, u), eh = extentAlong(kp, c, h);
        const L = eu[1] - eu[0], W = eh[1] - eh[0];
        const mid = c.clone().addScaledVector(u, (eu[0] + eu[1]) / 2).addScaledVector(h, (eh[0] + eh[1]) / 2);
        const sinus = mid.clone().addScaledVector(h, 0.16 * W);
        const pelvisC = mid.clone().addScaledVector(h, 0.33 * W).addScaledVector(u, -0.04 * L);
        const n = 7, bases = [], apexes = [];
        for (let i = 0; i < n; i++) {
          const th = (-112 + (224 * i) / (n - 1)) * Math.PI / 180;
          const base = mid.clone().addScaledVector(h, 0.03 * W - Math.cos(th) * 0.36 * W).addScaledVector(u, Math.sin(th) * 0.375 * L);
          const apex = sinus.clone().lerp(base, 0.4);
          const dir = apex.clone().sub(base); const hgt = dir.length();
          const cone = new T.ConeGeometry(0.082 * L, hgt, 20, 1, false);
          cone.translate(0, hgt / 2, 0);
          pyr.push(placed(cone, base, dir));
          cal.push(tube([apex.clone().lerp(base, 0.06), apex.clone().lerp(pelvisC, 0.55), pelvisC], 2.3 * mm, 10));
          bases.push(base); apexes.push(apex);
        }
        const pel = new T.SphereGeometry(1, 20, 14);
        cal.push(placed(pel, pelvisC, u, v3(0.07 * L, 0.13 * L, 0.055 * L)));
        const ur = P[side + "_ureter"];
        const urTop = nearest([ur], pelvisC);
        cal.push(tube([pelvisC.clone().addScaledVector(u, -0.02 * L), pelvisC.clone().lerp(urTop, 0.5).addScaledVector(h, 0.03 * W), urTop], 3.2 * mm, 12));
        if (side === "l") {
          pts.kc = mid; pts.pelvis = pelvisC;
          pts.pyramid = bases[3].clone().lerp(apexes[3], 0.45);
          pts.papilla = apexes[5];
          pts.calyx = apexes[1].clone().lerp(pelvisC, 0.45);
          pts.column = bases[4].clone().lerp(bases[5], 0.5).lerp(sinus, 0.3);
          pts.cortex = bases[2].clone().lerp(sinus, -0.14);
          pts.hilum = mid.clone().addScaledVector(h, 0.47 * W);
          pts.capsule = extreme([kp], mid, h.clone().multiplyScalar(-1).addScaledVector(u, -0.35).normalize());
          pts.upperpole = extreme([kp], mid, u);
        }
      });
      ctx.addMesh("pyramids", merge(pyr), { color: "#8f2f3a" });
      ctx.addMesh("calyces", merge(cal), { color: "#f1d9a0" });
    },

    brain(ctx) {
      const P = ctx.pos, mm = ctx.mm, pts = ctx.points;
      const vc = centroid(P.ventricles);
      pts.mid = centroid(P.pineal);
      pts.v3 = nearest([P.ventricles], centroid(P.thalamus).add(v3(0, -6 * mm, 8 * mm)));
      pts.v4 = nearest([P.ventricles], centroid(P.pons).add(v3(0, 0, -22 * mm)));
      pts.vlat = extreme([P.ventricles], vc, v3(0.5, 0.6, 0.6).normalize());
    },
  };

  /* ---------- класс просмотрщика ---------- */
  class AnatomyViewer {
    constructor(stage, opts) {
      this.stage = stage;
      this.opts = opts || {};
      this.renderer = new T.WebGLRenderer({ antialias: true, alpha: true });
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      this.renderer.localClippingEnabled = true;
      this.canvas = this.renderer.domElement;
      this.canvas.className = "stage-canvas";
      stage.appendChild(this.canvas);
      this.svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      this.svg.setAttribute("class", "stage-lines");
      stage.appendChild(this.svg);
      this.layer = document.createElement("div");
      this.layer.className = "stage-labels";
      stage.appendChild(this.layer);

      this.scene = new T.Scene();
      this.camera = new T.PerspectiveCamera(30, 1, 0.05, 50);
      this.scene.add(new T.HemisphereLight(0xfff1ea, 0x1a1420, 0.95));
      this.key = new T.DirectionalLight(0xffffff, 1.5);
      this.fill = new T.DirectionalLight(0x9db8ff, 0.55);
      this.rim = new T.DirectionalLight(0xffd0c0, 0.8);
      this.scene.add(this.key, this.fill, this.rim, this.camera);
      this.root = new T.Group();
      this.scene.add(this.root);

      this.orbit = { az: 0, el: 0.1, dist: 4.4, target: v3(0, 0, 0) };
      this.goal = { az: 0, el: 0.1, dist: 4.4, target: v3(0, 0, 0) };
      this.autoRotate = false;
      this.labelMode = "full";
      this.shellOpacity = 1;
      this.meshes = {}; this.structs = []; this.labels = [];
      this.selected = null; this.organ = null; this.view = null;
      this.clipPlane = new T.Plane(v3(-1, 0, 0), 0);
      this._bindPointer();
      this._ro = new ResizeObserver(() => this._resize());
      this._ro.observe(stage);
      this._resize();
      this._tick = this._tick.bind(this);
      requestAnimationFrame(this._tick);
    }

    _resize() {
      const w = this.stage.clientWidth || 600, h = this.stage.clientHeight || 500;
      this.W = w; this.H = h;
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      this.svg.setAttribute("viewBox", "0 0 " + w + " " + h);
    }

    _bindPointer() {
      const el = this.canvas, ptr = new Map();
      let moved = 0, pinch = 0, lastTap = 0;
      const start = { x: 0, y: 0 };
      el.addEventListener("pointerdown", e => {
        el.setPointerCapture(e.pointerId);
        ptr.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (ptr.size === 1) { moved = 0; start.x = e.clientX; start.y = e.clientY; }
        if (ptr.size === 2) { const p = [...ptr.values()]; pinch = Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y); }
        this.userActive = true;
      });
      el.addEventListener("pointermove", e => {
        const p = ptr.get(e.pointerId);
        if (!p) { this._hover(e); return; }
        const dx = e.clientX - p.x, dy = e.clientY - p.y;
        p.x = e.clientX; p.y = e.clientY;
        if (ptr.size === 1) {
          moved += Math.abs(dx) + Math.abs(dy);
          if (e.shiftKey || e.buttons === 2) {
            const k = this.goal.dist * 0.0011;
            const right = v3(1, 0, 0).applyQuaternion(this.camera.quaternion), up = v3(0, 1, 0).applyQuaternion(this.camera.quaternion);
            this.goal.target.addScaledVector(right, -dx * k).addScaledVector(up, dy * k);
          } else {
            this.goal.az -= dx * 0.0075;
            this.goal.el = Math.max(-1.45, Math.min(1.45, this.goal.el + dy * 0.0075));
          }
        } else if (ptr.size === 2) {
          const q = [...ptr.values()]; const d = Math.hypot(q[0].x - q[1].x, q[0].y - q[1].y);
          if (pinch > 0) this._zoom(pinch / d);
          pinch = d; moved += 10;
        }
      });
      const up = e => {
        if (!ptr.has(e.pointerId)) return;
        ptr.delete(e.pointerId);
        if (ptr.size === 0) {
          this.userActive = false;
          if (moved < 6 && e.type === "pointerup") {
            const now = performance.now();
            if (now - lastTap < 320) this.resetCamera(); else this._pick(e);
            lastTap = now;
          }
        }
      };
      el.addEventListener("pointerup", up);
      el.addEventListener("pointercancel", up);
      el.addEventListener("contextmenu", e => e.preventDefault());
      el.addEventListener("wheel", e => { e.preventDefault(); this._zoom(Math.exp(e.deltaY * 0.0012)); }, { passive: false });
    }
    _zoom(f) { this.goal.dist = Math.max(0.7, Math.min(9, this.goal.dist * f)); }

    _ray(e) {
      const r = this.canvas.getBoundingClientRect();
      const ndc = new T.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      const rc = new T.Raycaster();
      rc.setFromCamera(ndc, this.camera);
      const list = Object.values(this.meshes).filter(m => m.mesh.visible).map(m => m.mesh);
      let hits = rc.intersectObjects(list, false);
      if (this.view && this.view.clip) hits = hits.filter(h => this.clipPlane.distanceToPoint(h.point) >= 0);
      const seeThrough = this.shellOpacity < 0.6;
      const pickable = h => this._structOfMesh(h.object.userData.id);
      if (seeThrough) {
        const inner = hits.find(h => !h.object.userData.shell && pickable(h));
        if (inner) return inner;
      }
      return hits.find(pickable) || null;
    }
    _structOfMesh(id) {
      const shown = this.structs.filter(s => s.shown && s.def.m && s.def.m.includes(id));
      return shown[0] || null;
    }
    _pick(e) {
      const hit = this._ray(e);
      const s = hit ? this._structOfMesh(hit.object.userData.id) : null;
      if (this.opts.onPick) this.opts.onPick(s ? s.def.id : null);
    }
    _hover(e) {
      if (e.pointerType !== "mouse") return;
      const now = performance.now();
      if (now - (this._lastHover || 0) < 60) return;
      this._lastHover = now;
      const hit = this._ray(e);
      const s = hit ? this._structOfMesh(hit.object.userData.id) : null;
      this.canvas.style.cursor = s ? "pointer" : "grab";
      this._setHover(s ? s.def.id : null);
    }
    _setHover(id) {
      if (this.hoverId === id) return;
      this.hoverId = id;
      this.labels.forEach(l => l.el.classList.toggle("is-hover", l.s.def.id === id));
    }

    /* ----- загрузка органа ----- */
    async loadOrgan(def) {
      const data = await loadData(def.id);
      this._dispose();
      this.organ = def;
      const meta = data.meta;
      if (!data.buf) data.buf = b64ToBuffer(data.b64);
      const mm = 1 / meta.scale;
      const pos = {};
      const ctx = { mm, pos, points: {}, addMesh: (id, geom, style) => this._addMesh(id, geom, Object.assign({}, style, def.meshes[id] || {})) };
      meta.parts.forEach(p => {
        const q = new Int16Array(data.buf, p.vo, p.nv * 3);
        const f = new Float32Array(p.nv * 3);
        for (let i = 0; i < f.length; i++) f[i] = q[i] / 32767;
        const idx = p.u32 ? new Uint32Array(data.buf, p.io, p.nt * 3) : new Uint16Array(data.buf, p.io, p.nt * 3);
        const g = new T.BufferGeometry();
        g.setAttribute("position", new T.BufferAttribute(f, 3));
        g.setIndex(new T.BufferAttribute(idx, 1));
        g.computeVertexNormals();
        pos[p.id] = f;
        this._addMesh(p.id, g, def.meshes[p.id] || {});
      });
      if (SETUPS[def.id]) SETUPS[def.id](ctx);
      Object.keys(this.meshes).forEach(id => { if (!pos[id]) pos[id] = this.meshes[id].mesh.geometry.attributes.position.array; });
      this.points = ctx.points; this.pos = pos; this.mm = mm;
      this.structs = def.structures.map((s, i) => ({ def: s, index: i, shown: false, anchor: null, normal: null }));
      this._buildLabels();
      this.selected = null;
      this.setView(def.views[0].id, true);
    }

    _addMesh(id, geom, style) {
      const shell = !!style.shell;
      const mat = new T.MeshPhongMaterial({
        color: new T.Color(style.color || "#c66"),
        specular: new T.Color(style.glow ? 0x000000 : 0x55484a),
        shininess: style.shininess || 42,
        emissive: new T.Color(style.emissive || 0x000000),
        emissiveIntensity: style.emissiveIntensity || 1,
        transparent: shell,
        clippingPlanes: [],
      });
      const fres = { value: 0 };
      if (shell) {
        mat.onBeforeCompile = sh => {
          sh.uniforms.uFres = fres;
          sh.fragmentShader = sh.fragmentShader
            .replace("void main() {", "uniform float uFres;\nvoid main() {")
            .replace("#include <dithering_fragment>", "#include <dithering_fragment>\n float fr = 1.0 - abs(dot(normalize(vNormal), normalize(vViewPosition)));\n gl_FragColor.a *= mix(1.0, 0.5 + 1.7 * pow(fr, 1.6), uFres);");
        };
      }
      const mesh = new T.Mesh(geom, mat);
      mesh.userData = { id, shell };
      mesh.renderOrder = shell ? 5 : 1;
      const cap = new T.Mesh(geom, new T.MeshBasicMaterial({ color: new T.Color(style.cut || style.color || "#c66").multiplyScalar(0.72), side: T.BackSide, clippingPlanes: [this.clipPlane] }));
      cap.visible = false; cap.userData = { cap: true };
      this.root.add(mesh, cap);
      this.meshes[id] = { mesh, cap, mat, fres, shell, base: mat.color.clone(), baseEm: mat.emissive.clone(), baseEmI: mat.emissiveIntensity, style };
    }

    _posOf(ids) { return ids.map(i => this.pos[i]).filter(Boolean); }
    _computeAnchor(s) {
      const vid = this.view ? this.view.id : "";
      const a = (s.def.av && s.def.av[vid]) || s.def.a || {};
      if (a.pt) { s.anchor = this.points[a.pt] ? this.points[a.pt].clone() : v3(0, 0, 0); s.normal = null; return; }
      const ids = [].concat(a.mesh || s.def.m || []);
      const list = this._posOf(ids);
      if (!list.length) { s.anchor = v3(0, 0, 0); return; }
      const all = list.length === 1 ? list[0] : null;
      const c = all ? centroid(all) : list.map(centroid).reduce((x, y) => x.add(y), v3(0, 0, 0)).multiplyScalar(1 / list.length);
      if (a.near) {
        const base = this.points[a.near] || c;
        const off = a.off || [0, 0, 0];
        s.anchor = nearest(list, base.clone().add(v3(off[0], off[1], off[2]).multiplyScalar(this.mm)));
        s.normal = a.dir ? v3(a.dir[0], a.dir[1], a.dir[2]).normalize() : null;
        return;
      }
      if (a.center) { s.anchor = nearest(list, c); s.normal = null; return; }
      if (a.slice) {
        const mx = this.points.mid ? this.points.mid.x : 0, tol = 2.5 * this.mm;
        let dmin = Infinity;
        for (const pos of list) for (let i = 0; i < pos.length; i += 3) { const d = mx - pos[i]; if (d >= -0.5 * this.mm && d < dmin) dmin = d; }
        const acc = v3(0, 0, 0); let n = 0;
        for (const pos of list) for (let i = 0; i < pos.length; i += 3) { const d = mx - pos[i]; if (d >= -0.5 * this.mm && d <= dmin + tol) { acc.x += pos[i]; acc.y += pos[i + 1]; acc.z += pos[i + 2]; n++; } }
        s.anchor = n ? acc.multiplyScalar(1 / n) : nearest(list, c);
        s.anchor.x = Math.min(s.anchor.x, mx);
        s.normal = null; return;
      }
      const d = a.dir ? v3(a.dir[0], a.dir[1], a.dir[2]).normalize() : c.clone().normalize().add(v3(0, 0, 0.7)).normalize();
      s.anchor = extreme(list, c, d);
      s.normal = a.inside ? null : d;
    }

    _buildLabels() {
      this.layer.innerHTML = ""; this.svg.innerHTML = "";
      this.labels = this.structs.map(s => {
        const el = document.createElement("button");
        el.type = "button"; el.className = "lbl";
        const dot = document.createElement("button");
        dot.type = "button"; dot.className = "dot";
        const line = document.createElementNS("http://www.w3.org/2000/svg", "path");
        this.layer.appendChild(el); this.layer.appendChild(dot); this.svg.appendChild(line);
        const pick = ev => { ev.stopPropagation(); if (this.opts.onPick) this.opts.onPick(s.def.id); };
        el.addEventListener("click", pick); dot.addEventListener("click", pick);
        const over = () => this._setHover(s.def.id), out = () => this._setHover(null);
        el.addEventListener("pointerenter", over); el.addEventListener("pointerleave", out);
        dot.addEventListener("pointerenter", over); dot.addEventListener("pointerleave", out);
        return { s, el, dot, line, w: 0, h: 0 };
      });
      this.refreshLabelText();
    }
    refreshLabelText() {
      this.labels.forEach((l, i) => {
        l.el.textContent = this.opts.labelText ? this.opts.labelText(l.s.def) : l.s.def.id;
        l.w = 0;
      });
      this._numberDots();
    }
    _numberDots() {
      let n = 0;
      this.labels.forEach(l => { if (l.s.shown) { n++; l.num = n; l.dot.textContent = this.quiz ? "?" : String(n); } });
    }

    /* ----- виды ----- */
    setView(viewId, instant) {
      const def = this.organ; if (!def) return;
      const view = def.views.find(v => v.id === viewId) || def.views[0];
      this.view = view;
      const hide = new Set(view.hide || []);
      const only = view.only ? new Set(view.only) : null;
      Object.entries(this.meshes).forEach(([id, m]) => {
        const vis = only ? only.has(id) : !hide.has(id);
        m.mesh.visible = vis;
        m.cap.visible = vis && !!view.clip;
        m.mat.clippingPlanes = view.clip ? [this.clipPlane] : [];
        m.mat.side = view.clip ? T.DoubleSide : T.FrontSide;
        m.mat.needsUpdate = true;
      });
      if (view.clip) {
        const n = v3(view.clip[0], view.clip[1], view.clip[2]);
        const c = view.clip[3] === "mid" && this.points.mid ? -n.dot(this.points.mid) - 0.4 * this.mm : (view.clip[3] || 0) * this.mm;
        this.clipPlane.set(n, c);
      }
      this.structs.forEach(s => this._computeAnchor(s));
      const labelSet = new Set(view.labels);
      this.structs.forEach(s => { s.shown = labelSet.has(s.def.id); });
      this._numberDots();
      this.shellOpacity = view.shell == null ? 1 : view.shell;
      this._applyMaterials();
      const cam = view.cam || [0, 6, 4.4];
      const tgt = view.target && this.points[view.target] ? this.points[view.target].clone() : v3(0, 0, 0);
      let az = cam[0] * Math.PI / 180;
      const twoPi = Math.PI * 2;
      az += Math.round((this.orbit.az - az) / twoPi) * twoPi;
      this.goal = { az, el: cam[1] * Math.PI / 180, dist: cam[2] * this._fitScale(), target: tgt };
      this.home = { az: this.goal.az, el: this.goal.el, dist: this.goal.dist, target: tgt.clone() };
      if (instant) this.orbit = { az: this.goal.az, el: this.goal.el, dist: this.goal.dist, target: tgt.clone() };
      if (this.selected && !labelSet.has(this.selected)) this.select(null);
      if (this.opts.onView) this.opts.onView(view);
    }
    _fitScale() { const asp = this.W / this.H; return asp < 1.15 ? Math.min(2.4, 1.15 / asp) : 1; }
    visibleStructIds() { return this.structs.filter(s => s.shown).map(s => s.def.id); }
    numberOf(id) { const l = this.labels.find(x => x.s.def.id === id); return l && l.s.shown ? l.num : null; }

    setShellOpacity(o) { this.shellOpacity = o; this._applyMaterials(); }
    setLabelMode(m) { this.labelMode = m; }
    setAutoRotate(b) { this.autoRotate = b; }
    setQuiz(b) { this.quiz = b; this._numberDots(); this.layer.classList.toggle("is-quiz", !!b); }
    flash(id, cls) {
      const l = this.labels.find(x => x.s.def.id === id); if (!l) return;
      l.dot.classList.remove("ok", "bad"); void l.dot.offsetWidth; l.dot.classList.add(cls);
      setTimeout(() => l.dot.classList.remove(cls), 900);
    }
    resetCamera() { if (this.home) this.goal = { az: this.home.az + Math.round((this.orbit.az - this.home.az) / (2 * Math.PI)) * 2 * Math.PI, el: this.home.el, dist: this.home.dist, target: this.home.target.clone() }; }

    select(id) {
      this.selected = id || null;
      this._applyMaterials();
      this.labels.forEach(l => { const on = l.s.def.id === this.selected; l.el.classList.toggle("is-sel", on); l.dot.classList.toggle("is-sel", on); });
    }
    focus(id) {
      const s = this.structs.find(x => x.def.id === id); if (!s || !s.anchor) return;
      const dir = s.normal ? s.normal.clone() : s.anchor.clone().sub(this.goal.target);
      if (dir.lengthSq() < 1e-6) return;
      dir.normalize();
      const facing = dir.dot(this._camDir());
      if (s.normal && facing < 0.15) {
        let az = Math.atan2(dir.x, dir.z);
        az += Math.round((this.orbit.az - az) / (2 * Math.PI)) * 2 * Math.PI;
        this.goal.az = this.orbit.az + (az - this.orbit.az) * 0.8;
        this.goal.el = Math.max(-1.2, Math.min(1.2, Math.asin(Math.max(-1, Math.min(1, dir.y))) * 0.7));
      }
    }
    _camDir() { return this.camera.position.clone().sub(this.orbit.target).normalize(); }

    _applyMaterials() {
      const selS = this.selected ? this.structs.find(s => s.def.id === this.selected) : null;
      const selMeshes = new Set(selS && selS.def.m ? selS.def.m : []);
      const selInner = selS && (!selS.def.m || !selS.def.m.length || selS.def.m.some(id => this.meshes[id] && !this.meshes[id].shell));
      const clip = this.view && this.view.clip;
      Object.entries(this.meshes).forEach(([id, m]) => {
        const isSel = selMeshes.has(id);
        if (m.shell) {
          let o = clip ? 1 : this.shellOpacity;
          if (!clip && selS && !isSel) o = Math.min(o, selInner ? 0.22 : 0.45);
          if (!clip && isSel) o = Math.max(o, 0.9);
          const solid = o >= 0.97;
          m.mat.opacity = o;
          m.mat.depthWrite = solid;
          m.fres.value = solid ? 0 : 1;
          m.mesh.renderOrder = solid ? 1 : 5;
        }
        const dim = selS && !isSel && !m.style.glow ? 0.62 : 1;
        m.mat.color.copy(m.base).multiplyScalar(dim);
        if (isSel) { m.mat.emissive.copy(ACCENT); m.mat.emissiveIntensity = m.style.glow ? 1.1 : 0.3; }
        else { m.mat.emissive.copy(m.baseEm); m.mat.emissiveIntensity = m.baseEmI; }
      });
    }

    /* ----- кадр ----- */
    _tick() {
      requestAnimationFrame(this._tick);
      if (!this.organ) return;
      const o = this.orbit, g = this.goal, k = 0.14;
      if (this.autoRotate && !this.userActive) g.az += 0.0035;
      o.az += (g.az - o.az) * k; o.el += (g.el - o.el) * k; o.dist += (g.dist - o.dist) * k;
      o.target.lerp(g.target, k);
      const ce = Math.cos(o.el);
      this.camera.position.set(o.target.x + o.dist * Math.sin(o.az) * ce, o.target.y + o.dist * Math.sin(o.el), o.target.z + o.dist * Math.cos(o.az) * ce);
      this.camera.lookAt(o.target);
      const q = this.camera.quaternion;
      this.key.position.copy(v3(-1.6, 2.2, 3).applyQuaternion(q));
      this.fill.position.copy(v3(3, 0.2, 1.2).applyQuaternion(q));
      this.rim.position.copy(v3(0.6, 1.4, -3).applyQuaternion(q));
      this.renderer.render(this.scene, this.camera);
      this._layoutLabels();
    }

    _layoutLabels() {
      const W = this.W, H = this.H, mode = W < 640 && this.labelMode === "full" ? "dots" : this.labelMode;
      const quiz = !!this.quiz;
      const camPos = this.camera.position;
      const centerS = this.orbit.target.clone().project(this.camera);
      const cx = (centerS.x * 0.5 + 0.5) * W;
      const colW = Math.max(120, Math.min(250, W * 0.25));
      const left = [], right = [];
      const tmp = v3(0, 0, 0);
      const clip = this.view && this.view.clip;
      for (const l of this.labels) {
        const s = l.s;
        if (!s.shown || mode === "off") { l.el.style.display = "none"; l.dot.style.display = "none"; l.line.style.display = "none"; continue; }
        tmp.copy(s.anchor).project(this.camera);
        l.x = (tmp.x * 0.5 + 0.5) * W; l.y = (-tmp.y * 0.5 + 0.5) * H;
        let back = false;
        if (s.normal) back = s.normal.dot(tmp.copy(camPos).sub(s.anchor).normalize()) < -0.12;
        if (clip && this.clipPlane.distanceToPoint(s.anchor) < -2 * this.mm) back = true;
        l.back = back;
        const off = tmp.z > 1 || l.x < -20 || l.x > W + 20 || l.y < -20 || l.y > H + 20;
        l.dot.style.display = off ? "none" : "";
        l.dot.style.transform = "translate(" + (l.x - 11).toFixed(1) + "px," + (l.y - 11).toFixed(1) + "px)";
        l.dot.classList.toggle("is-back", back);
        l.dot.classList.toggle("is-num", mode === "dots" || quiz);
        if (mode === "dots" || quiz || off) { l.el.style.display = "none"; l.line.style.display = "none"; continue; }
        l.el.style.display = ""; l.line.style.display = "";
        l.el.style.maxWidth = (colW - 16) + "px";
        if (!l.w) { l.w = l.el.offsetWidth; l.h = l.el.offsetHeight; }
        (l.x < cx ? left : right).push(l);
      }
      const place = (arr, isLeft) => {
        arr.sort((a, b) => a.y - b.y);
        const gap = 9, top = 58, bottom = H - 74;
        let prev = top - gap;
        arr.forEach(l => { l.ly = Math.max(l.y - l.h, prev + gap); prev = l.ly + l.h; });
        let next = bottom;
        for (let i = arr.length - 1; i >= 0; i--) { const l = arr[i]; if (l.ly + l.h > next) l.ly = next - l.h; next = l.ly - gap; }
        arr.forEach(l => {
          const lx = isLeft ? colW - l.w : W - colW;
          l.el.style.transform = "translate(" + lx.toFixed(1) + "px," + l.ly.toFixed(1) + "px)";
          l.el.classList.toggle("is-back", l.back);
          const ey = l.ly + l.h - 1, ex = isLeft ? colW : W - colW;
          const kx = ex + (isLeft ? 16 : -16);
          l.line.setAttribute("d", "M" + ex.toFixed(1) + " " + ey.toFixed(1) + "L" + kx.toFixed(1) + " " + ey.toFixed(1) + "L" + l.x.toFixed(1) + " " + l.y.toFixed(1));
          l.line.setAttribute("class", (l.back ? "is-back " : "") + (l.s.def.id === this.selected ? "is-sel " : "") + (l.s.def.id === this.hoverId ? "is-hover" : ""));
        });
      };
      place(left, true); place(right, false);
    }

    _dispose() {
      Object.values(this.meshes).forEach(m => { this.root.remove(m.mesh, m.cap); m.mesh.geometry.dispose(); m.mat.dispose(); m.cap.material.dispose(); });
      this.meshes = {}; this.structs = []; this.labels = [];
      this.layer.innerHTML = ""; this.svg.innerHTML = "";
    }
  }

  window.AnatomyViewer = AnatomyViewer;
})();
