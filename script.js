const heartCanvas = document.getElementById("heartCanvas");
const flowCanvas = document.getElementById("flowCanvas");
const heartCtx = heartCanvas.getContext("2d");
const flowCtx = flowCanvas.getContext("2d");

const btnStart = document.getElementById("btnStart");
const playPauseBtn = document.getElementById("playPause");
const restartBtn = document.getElementById("restart");
const stepBackBtn = document.getElementById("stepBack");
const stepForwardBtn = document.getElementById("stepForward");
const timelineScrubber = document.getElementById("timelineScrubber");
const currentTimeLabel = document.getElementById("currentTimeLabel");
const totalTimeLabel = document.getElementById("totalTimeLabel");
const timelineContextDetail = document.getElementById("timelineContextDetail");
const speedSelect = document.getElementById("speed");
const modeStatus = document.getElementById("modeStatus");
const loadingState = document.getElementById("loadingState");

const btnAtrialSystole = document.getElementById("btnAtrialSystole");
const btnIsoContraction = document.getElementById("btnIsoContraction");
const btnEjection = document.getElementById("btnEjection");
const btnIsoRelaxation = document.getElementById("btnIsoRelaxation");
const btnFilling = document.getElementById("btnFilling");
const stageDots = Array.from(document.querySelectorAll(".stage-dot"));

const eventTitle = document.getElementById("eventTitle");
const eventDescription = document.getElementById("eventDescription");
const eventSubtitle = document.getElementById("eventSubtitle");
const phaseTitle = document.getElementById("phaseTitle");
const phaseDescription = document.getElementById("phaseDescription");
const tricuspidState = document.getElementById("tricuspidState");
const mitralState = document.getElementById("mitralState");
const pulmonaryState = document.getElementById("pulmonaryState");
const aorticState = document.getElementById("aorticState");
const flowText = document.getElementById("flowText");
const triggerText = document.getElementById("triggerText");
const watchText = document.getElementById("watchText");
const heartVisualDescription = document.getElementById("heartVisualDescription");

const prefersReducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;

const FRAME_PATHS = [
  ...Array.from({ length: 20 }, (_, i) => `frames/frame_${String(i).padStart(2, "0")}.png`),
  ...Array.from({ length: 6 }, (_, i) => `frames/iso_contraction_${String(i).padStart(2, "0")}.png`),
  ...Array.from({ length: 6 }, (_, i) => `frames/iso_relaxation_${String(i).padStart(2, "0")}.png`)
];

const frames = Array(FRAME_PATHS.length).fill(null);

let playing = !prefersReducedMotion;
let speed = Number(speedSelect.value);
let playheadMs = 0;
let lastTime = performance.now();
let currentStage = "atrialSystole";
let playbackMode = "cycle";
let loopStage = null;
let lastFrameIndex = -1;
let lastInfoKey = "";

const interactiveControls = [
  btnStart, btnAtrialSystole, btnIsoContraction, btnEjection, btnIsoRelaxation, btnFilling,
  playPauseBtn, restartBtn, stepBackBtn, stepForwardBtn, timelineScrubber, speedSelect,
  ...stageDots
];

const CRITICAL_STAGE_FRAME_INDEXES = {
  isoContraction: [20, 21, 22, 23, 24, 25],
  isoRelaxation: [26, 27, 28, 29, 30, 31]
};

function setControlsDisabled(disabled) {
  interactiveControls.forEach((control) => {
    if (!control) return;
    control.disabled = disabled;
    control.setAttribute("aria-disabled", String(disabled));
  });
}

async function ensureStageFrames(stageName) {
  const indexes = CRITICAL_STAGE_FRAME_INDEXES[stageName];
  if (!indexes) return;

  const missing = indexes.filter((index) => !frames[index]);
  if (!missing.length) return;

  loadingState.hidden = false;
  loadingState.textContent = `Loading ${STAGES[stageName].phase.title.toLowerCase()} animation…`;

  try {
    await Promise.all(missing.map((index) => loadFrame(index).catch((error) => {
      console.warn(error.message);
      return null;
    })));
  } finally {
    loadingState.hidden = true;
    loadingState.textContent = "Loading cardiac animation…";
  }
}

function loadFrame(index) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => {
      frames[index] = img;
      resolve(img);
    };
    img.onerror = () => reject(new Error(`Unable to load ${FRAME_PATHS[index]}`));
    img.src = FRAME_PATHS[index];
  });
}

async function initializeFrames() {
  try {
    setControlsDisabled(true);
    const priorityIndexes = [0, ...CRITICAL_STAGE_FRAME_INDEXES.isoContraction, ...CRITICAL_STAGE_FRAME_INDEXES.isoRelaxation];

    await Promise.all(priorityIndexes.map((index) => loadFrame(index).catch((error) => {
      console.warn(error.message);
      return null;
    })));

    setControlsDisabled(false);
    loadingState.hidden = true;
    render(true);
    requestAnimationFrame(animate);

    const remainingLoads = [];
    for (let i = 0; i < frames.length; i += 1) {
      if (priorityIndexes.includes(i) || frames[i]) continue;
      remainingLoads.push(
        loadFrame(i).catch((error) => {
          console.warn(error.message);
          return null;
        })
      );
    }
    Promise.allSettled(remainingLoads);
  } catch (error) {
    console.error(error);
    playing = false;
    updatePlayButton();
    setControlsDisabled(false);
    loadingState.hidden = false;
    loadingState.textContent = "Unable to load the heart animation. Check the frames folder and refresh the page.";
  }
}

function roundRect(ctx, x, y, width, height, radius, fill, stroke) {
  const corners = typeof radius === "number"
    ? { tl: radius, tr: radius, br: radius, bl: radius }
    : radius;

  ctx.beginPath();
  ctx.moveTo(x + corners.tl, y);
  ctx.lineTo(x + width - corners.tr, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + corners.tr);
  ctx.lineTo(x + width, y + height - corners.br);
  ctx.quadraticCurveTo(x + width, y + height, x + width - corners.br, y + height);
  ctx.lineTo(x + corners.bl, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - corners.bl);
  ctx.lineTo(x, y + corners.tl);
  ctx.quadraticCurveTo(x, y, x + corners.tl, y);
  ctx.closePath();
  if (fill) ctx.fill();
  if (stroke) ctx.stroke();
}

function drawStraightTeachingArrow(x1, y1, x2, y2, color, width = 18, alpha = 0.88, head = 30) {
  flowCtx.save();
  flowCtx.globalAlpha = alpha;
  flowCtx.strokeStyle = color;
  flowCtx.fillStyle = color;
  flowCtx.lineWidth = width;
  flowCtx.lineCap = "round";
  flowCtx.lineJoin = "round";
  flowCtx.shadowColor = "rgba(0,0,0,0.08)";
  flowCtx.shadowBlur = 3;

  flowCtx.beginPath();
  flowCtx.moveTo(x1, y1);
  flowCtx.lineTo(x2, y2);
  flowCtx.stroke();

  const angle = Math.atan2(y2 - y1, x2 - x1);
  flowCtx.translate(x2, y2);
  flowCtx.rotate(angle);
  flowCtx.beginPath();
  flowCtx.moveTo(0, 0);
  flowCtx.lineTo(-head, -head * 0.55);
  flowCtx.lineTo(-head, head * 0.55);
  flowCtx.closePath();
  flowCtx.fill();
  flowCtx.restore();
}

function drawCallout(label, anchorX, anchorY, boxX, boxY, color) {
  flowCtx.save();
  flowCtx.strokeStyle = color;
  flowCtx.fillStyle = color;
  flowCtx.lineWidth = 4;
  flowCtx.globalAlpha = 0.96;

  flowCtx.beginPath();
  flowCtx.moveTo(boxX, boxY);
  flowCtx.lineTo(anchorX, anchorY);
  flowCtx.stroke();

  flowCtx.beginPath();
  flowCtx.arc(anchorX, anchorY, 6, 0, Math.PI * 2);
  flowCtx.fill();

  flowCtx.font = '700 30px "Segoe UI", Arial, sans-serif';
  const textWidth = flowCtx.measureText(label).width;
  const padX = 16;
  const boxWidth = textWidth + padX * 2;
  const boxHeight = 44;

  flowCtx.fillStyle = "rgba(255,255,255,0.95)";
  flowCtx.strokeStyle = color;
  flowCtx.lineWidth = 3;
  roundRect(flowCtx, boxX - 2, boxY - boxHeight + 8, boxWidth, boxHeight, 12, true, true);

  flowCtx.fillStyle = color;
  flowCtx.fillText(label, boxX + padX - 2, boxY - 10);
  flowCtx.restore();
}

function setValve(el, state) {
  el.textContent = state;
  el.classList.remove("open", "closed");
  el.classList.add(state.toLowerCase());
}

function drawHeart(frameIndex) {
  const img = frames[frameIndex];
  if (!img) return false;

  heartCtx.clearRect(0, 0, heartCanvas.width, heartCanvas.height);
  heartCtx.drawImage(img, 0, 0, heartCanvas.width, heartCanvas.height);
  return true;
}

function drawConstantAtrialBlood() {
  flowCtx.save();

  flowCtx.fillStyle = "rgba(69, 126, 184, 0.22)";
  flowCtx.beginPath();
  flowCtx.ellipse(275, 675, 42, 20, -0.10, 0, Math.PI * 2);
  flowCtx.fill();

  flowCtx.fillStyle = "rgba(184, 65, 65, 0.20)";
  flowCtx.beginPath();
  flowCtx.ellipse(720, 600, 40, 18, 0.08, 0, Math.PI * 2);
  flowCtx.fill();

  flowCtx.restore();
}

function drawChamberLabels() {
  drawCallout("Right atrium", 265, 675, 55, 610, "#397bb7");
  drawCallout("Left atrium", 720, 585, 820, 540, "#b42318");
  drawCallout("Right ventricle", 430, 1000, 70, 1085, "#397bb7");
  drawCallout("Left ventricle", 770, 915, 820, 1030, "#b42318");
}

function drawSystolicLabels() {
  drawCallout("Aorta", 610, 175, 820, 130, "#b42318");
  drawCallout("Pulmonary trunk", 760, 250, 720, 190, "#397bb7");
  drawCallout("Right atrium", 265, 675, 40, 595, "#397bb7");
  drawCallout("Left atrium", 705, 575, 790, 525, "#b42318");
  drawCallout("Pulmonary valve", 500, 685, 610, 600, "#397bb7");
  drawCallout("Aortic valve", 590, 675, 635, 740, "#b42318");
  drawCallout("Right ventricle", 435, 1000, 55, 1095, "#397bb7");
  drawCallout("Left ventricle", 790, 915, 820, 1045, "#b42318");
}

function drawAtrialCompressionCue(progress) {
  const strength = Math.sin(progress * Math.PI);
  if (strength <= 0) return;

  flowCtx.save();
  flowCtx.lineWidth = 6;
  flowCtx.globalAlpha = 0.12 + strength * 0.16;

  flowCtx.strokeStyle = "#5e95ca";
  flowCtx.beginPath();
  flowCtx.ellipse(265, 610, 120 - strength * 16, 170 - strength * 24, -0.08, 0, Math.PI * 2);
  flowCtx.stroke();

  flowCtx.strokeStyle = "#e65353";
  flowCtx.beginPath();
  flowCtx.ellipse(715, 535, 120 - strength * 18, 125 - strength * 18, 0.10, 0, Math.PI * 2);
  flowCtx.stroke();
  flowCtx.restore();
}

function drawVentricularCompressionCue(progress) {
  const strength = Math.sin(progress * Math.PI);
  if (strength <= 0) return;

  flowCtx.save();
  flowCtx.lineWidth = 6;
  flowCtx.globalAlpha = 0.12 + strength * 0.16;

  flowCtx.strokeStyle = "#6a8fc3";
  flowCtx.beginPath();
  flowCtx.ellipse(430, 915, 132 - strength * 22, 190 - strength * 28, -0.40, 0, Math.PI * 2);
  flowCtx.stroke();

  flowCtx.strokeStyle = "#e76a6a";
  flowCtx.beginPath();
  flowCtx.ellipse(755, 820, 145 - strength * 26, 220 - strength * 34, 0.36, 0, Math.PI * 2);
  flowCtx.stroke();
  flowCtx.restore();
}

const STAGES = {
  atrialSystole: {
    button: btnAtrialSystole,
    title: "Atrial Systole",
    subtitle: "(Late ventricular diastole)",
    trigger: "The sinoatrial node — the heart's pacemaker — initiates a new cardiac cycle, sending a depolarisation wave across both atria.",
    description: "Passive filling has brought the ventricles to roughly 75% of their end-diastolic volume, but atrial contraction is needed to complete filling. The sinoatrial node fires, atrial pressure rises above ventricular diastolic pressure, and the remaining volume is driven through the open AV valves. This stage ends when ventricular depolarisation triggers myocardial contraction, ventricular pressure rises above atrial pressure, and the AV valves close.",
    volume: "↑ to EDV",
    sound: "None normally",
    totalMs: 1200,
    phase: {
      title: "Atrial Systole",
      description: "Both atria contract simultaneously, propelling blood through the open AV valves and completing filling to end-diastolic volume (EDV). The semilunar valves are closed throughout — no blood enters the great vessels during this phase.",
      watch: "Watch the pulsing blue and red arrows — they show blood flowing simultaneously from both atria into the ventricles. Notice the arrows intensify as atrial contraction peaks, then fade as the stage ends.",
      tricuspid: "Open",
      mitral: "Open",
      pulmonary: "Closed",
      aortic: "Closed",
      flow: "Right atrium → tricuspid valve → right ventricle; left atrium → mitral valve → left ventricle."
    },
    frameAt(t) {
      const p = Math.min(1, t / this.totalMs);
      return Math.round(p * 4);
    },
    overlay(t) {
      drawCallout("Vena cava", 230, 500, 70, 430, "#397bb7");
      drawCallout("Pulmonary veins", 895, 515, 815, 430, "#b42318");
      drawCallout("Tricuspid valve", 300, 885, 80, 835, "#397bb7");
      drawCallout("Mitral valve", 780, 620, 835, 675, "#b42318");
      drawChamberLabels();

      const progress = Math.min(1, t / this.totalMs);
      drawAtrialCompressionCue(progress);
      const pulseAlpha = 0.38 + 0.44 * Math.sin(progress * Math.PI);
      drawStraightTeachingArrow(285, 778, 484, 1024, "#5d89c7", 18, pulseAlpha, 30);
      drawStraightTeachingArrow(706, 576, 908, 830, "#b44949", 18, pulseAlpha, 30);
    }
  },

  isoContraction: {
    button: btnIsoContraction,
    title: "Ventricular Systole",
    subtitle: "(Onset of ventricular systole)",
    trigger: "The AV valves closed as rising ventricular pressure exceeded atrial pressure — ending Stage 1 and beginning ventricular systole.",
    description: "Ventricular depolarisation triggers myocardial contraction and ventricular pressure begins to rise. The moment ventricular pressure exceeds atrial pressure, the AV valves close — producing the first heart sound (S1). The semilunar valves remain closed because ventricular pressure has not yet reached aortic or pulmonary trunk pressure. With all four valves closed, ventricular volume is locked at EDV while pressure rises steeply. This stage ends the instant ventricular pressure exceeds outflow-tract pressure and forces the semilunar valves open.",
    volume: "Constant at EDV",
    sound: "S1 at onset",
    totalMs: 900,
    phase: {
      title: "Ventricular Isovolumetric Contraction",
      description: "All four valves are closed. The ventricular walls move inward and myocardial tension rises, generating rapidly increasing pressure at constant volume. No blood can enter or leave — volume is fixed at EDV. This phase ends the moment ventricular pressure exceeds aortic and pulmonary trunk pressures and the semilunar valves are forced open.",
      watch: "Watch the ventricular walls compress inward — but notice no flow arrows appear. All four valves are closed; pressure is rising steeply but no blood is moving. This is isovolumetric — the walls move but the volume cannot change.",
      tricuspid: "Closed",
      mitral: "Closed",
      pulmonary: "Closed",
      aortic: "Closed",
      flow: "No ventricular inflow or outflow occurs while all four valves are closed."
    },
    frameAt(t) {
      const p = Math.min(1, t / this.totalMs);
      return 20 + Math.min(5, Math.floor(p * 6));
    },
    overlay(t) {
      drawSystolicLabels();
      const progress = Math.min(1, t / this.totalMs);
      drawVentricularCompressionCue(progress);
    }
  },

  ejection: {
    button: btnEjection,
    title: "Ventricular Systole",
    subtitle: "(Ventricular systole — ejection phase)",
    trigger: "Ventricular pressure exceeded aortic and pulmonary trunk pressures — the semilunar valves were forced open, ending Stage 2.",
    description: "Ventricular pressure now exceeds aortic and pulmonary trunk pressures, so the semilunar valves open and ejection begins. While the pressure gradient is large, ejection is rapid (rapid-ejection phase). As ventricular pressure peaks and begins to fall, the gradient narrows and ejection slows (reduced-ejection phase). Forward flow continues briefly even as ventricular pressure falls below outflow-tract pressure, sustained by the momentum of the ejected blood, until the semilunar valves finally close.",
    volume: "↓ toward ESV",
    sound: "None during phase",
    totalMs: 1200,
    phase: {
      title: "Ventricular Ejection",
      description: "The aortic and pulmonary valves are open; the AV valves remain closed. Blood leaves the right ventricle into the pulmonary trunk and the left ventricle into the aorta. Ventricular volume falls throughout ejection until end-systolic volume (ESV) is reached — the blood that remains is not ejected.",
      watch: "Watch the ejection arrows — blue into the pulmonary trunk, red into the aorta. They pulse strongly at first (rapid ejection), then fade as ventricular pressure peaks and falls (reduced ejection). Flow continues even as the arrows weaken.",
      tricuspid: "Closed",
      mitral: "Closed",
      pulmonary: "Open",
      aortic: "Open",
      flow: "Right ventricle → pulmonary trunk; left ventricle → aorta. Ventricular volume decreases throughout ejection."
    },
    frameAt(t) {
      const p = Math.min(1, t / this.totalMs);
      return 6 + Math.round(p * 5);
    },
    overlay(t) {
      drawSystolicLabels();
      const progress = Math.min(1, t / this.totalMs);
      drawVentricularCompressionCue(progress);
      const arrowAlpha = 0.35 + 0.5 * Math.sin(progress * Math.PI);
      drawStraightTeachingArrow(482, 944, 523, 426, "#00b0f0", 18, arrowAlpha, 30);
      drawStraightTeachingArrow(742, 860, 599, 722, "#ff0000", 18, arrowAlpha, 30);
      drawStraightTeachingArrow(417, 551, 352, 307, "#ff0000", 18, arrowAlpha, 30);
    }
  },

  isoRelaxation: {
    button: btnIsoRelaxation,
    title: "Ventricular Diastole",
    subtitle: "(Onset of ventricular diastole)",
    trigger: "Ventricular pressure fell below aortic and pulmonary trunk pressures — the reversed gradient closed the semilunar valves (S2), ending Stage 3.",
    description: "Ventricular relaxation causes pressure to fall. When it drops below aortic and pulmonary trunk pressures, the reversed pressure gradient closes the semilunar valves — producing the second heart sound (S2). The AV valves are still closed because ventricular pressure still exceeds atrial pressure. With all four valves closed, ventricular volume is locked at ESV while pressure continues to fall. This stage ends the instant ventricular pressure drops below atrial pressure and the AV valves open.",
    volume: "Constant at ESV",
    sound: "S2 at onset",
    totalMs: 900,
    phase: {
      title: "Ventricular Isovolumetric Relaxation",
      description: "All four valves are closed — this is the mirror image of Stage 2. The ventricular walls relax and pressure falls rapidly at constant volume (ESV). No blood can enter or leave. This phase ends the moment ventricular pressure falls below atrial pressure and the AV valves are pushed open.",
      watch: "Watch the ventricles expand — and again notice no flow arrows. This mirrors Stage 2: all valves are closed, the walls are moving, but volume cannot change. This time pressure is falling, not rising.",
      tricuspid: "Closed",
      mitral: "Closed",
      pulmonary: "Closed",
      aortic: "Closed",
      flow: "No ventricular inflow or outflow occurs while all four valves are closed."
    },
    frameAt(t) {
      const p = Math.min(1, t / this.totalMs);
      return 26 + Math.min(5, Math.floor(p * 6));
    },
    overlay() {
      drawSystolicLabels();
    }
  },

  filling: {
    button: btnFilling,
    title: "Ventricular Diastole",
    subtitle: "(Ventricular diastole — filling phase)",
    trigger: "Ventricular pressure fell below atrial pressure — the AV valves were pushed open by the pressure gradient, ending Stage 4.",
    description: "When ventricular pressure falls below atrial pressure, the AV valves open and blood that accumulated in the atria during ventricular systole flows rapidly into the ventricles — the rapid-filling phase, which provides the majority of end-diastolic volume. As atrial and ventricular pressures equalise, the gradient fades and flow slows; this quieter phase is diastasis. The cycle then restarts with atrial contraction.",
    volume: "↑ rapid → slower",
    sound: "S3 may be normal in youth",
    totalMs: 1200,
    phase: {
      title: "Passive Ventricular Filling",
      description: "The mitral and tricuspid valves are open; the semilunar valves are closed. Blood enters both ventricles rapidly at first, then more slowly during diastasis as the atrial-to-ventricular pressure gradient diminishes. Venous return from the venae cavae and pulmonary veins continuously replenishes the atria throughout this phase.",
      watch: "Watch the AV-valve arrows reappear as blood flows into the ventricles. Notice the arrows are strongest at the start of this phase (rapid filling) and fade during diastasis — driven entirely by the pressure gradient, not by any active pumping.",
      tricuspid: "Open",
      mitral: "Open",
      pulmonary: "Closed",
      aortic: "Closed",
      flow: "Venae cavae → right atrium → right ventricle; pulmonary veins → left atrium → left ventricle."
    },
    frameAt(t) {
      const p = Math.min(1, t / this.totalMs);
      return 13 + Math.round(p * 6);
    },
    overlay(t) {
      drawCallout("Vena cava", 230, 500, 70, 430, "#397bb7");
      drawCallout("Pulmonary veins", 895, 515, 815, 430, "#b42318");
      drawCallout("Tricuspid valve", 300, 885, 80, 835, "#397bb7");
      drawCallout("Mitral valve", 780, 620, 835, 675, "#b42318");
      drawChamberLabels();

      const progress = Math.min(1, t / this.totalMs);
      const arrowAlpha = 0.32 + 0.32 * Math.sin(progress * Math.PI);
      drawStraightTeachingArrow(285, 778, 484, 1024, "#5d89c7", 16, arrowAlpha, 28);
      drawStraightTeachingArrow(706, 576, 908, 830, "#b44949", 16, arrowAlpha, 28);
    }
  }
};

const STAGE_ORDER = ["atrialSystole", "isoContraction", "ejection", "isoRelaxation", "filling"];

const STAGE_TIMELINE = (() => {
  let cursor = 0;
  return STAGE_ORDER.map((name) => {
    const stage = STAGES[name];
    const start = cursor;
    const end = start + stage.totalMs;
    cursor = end;
    return { name, stage, start, end };
  });
})();

const TOTAL_CYCLE_MS = STAGE_TIMELINE[STAGE_TIMELINE.length - 1].end;
const SCRUB_STEP_MS = Number(timelineScrubber.step) || 10;

function getStageEntry(stageName) {
  return STAGE_TIMELINE.find((item) => item.name === stageName) || STAGE_TIMELINE[0];
}

function stageBounds(stageName) {
  const entry = getStageEntry(stageName);
  return { start: entry.start, end: entry.end };
}

function getStageAtPlayhead(ms) {
  const clamped = Math.max(0, Math.min(TOTAL_CYCLE_MS, ms));

  if (clamped === TOTAL_CYCLE_MS) {
    const last = STAGE_TIMELINE[STAGE_TIMELINE.length - 1];
    return { ...last, localMs: last.stage.totalMs };
  }

  const entry = STAGE_TIMELINE.find((item) => clamped >= item.start && clamped < item.end) || STAGE_TIMELINE[0];
  return { ...entry, localMs: clamped - entry.start };
}

function formatTime(ms) {
  return `${(ms / 1000).toFixed(2)} s`;
}

function setTimelineBounds() {
  if (playbackMode === "stage" && loopStage) {
    const { start, end } = stageBounds(loopStage);
    timelineScrubber.min = String(start);
    timelineScrubber.max = String(Math.max(start, end - SCRUB_STEP_MS));
    timelineContextDetail.textContent = `${STAGES[loopStage].phase.title} loop`;
  } else {
    timelineScrubber.min = "0";
    timelineScrubber.max = String(TOTAL_CYCLE_MS);
    timelineContextDetail.textContent = "Full-cycle teaching playback";
  }
}

function updateStageIndicators() {
  const cycleMode = playbackMode === "cycle";
  btnStart.classList.toggle("active", cycleMode);
  btnStart.setAttribute("aria-pressed", String(cycleMode));

  Object.entries(STAGES).forEach(([name, stage]) => {
    const current = name === currentStage;
    const selected = playbackMode === "stage" && name === loopStage;

    stage.button.classList.toggle("active", current);
    stage.button.classList.toggle("loop-selected", selected);
    stage.button.setAttribute("aria-pressed", String(selected));

    if (current) {
      stage.button.setAttribute("aria-current", "step");
    } else {
      stage.button.removeAttribute("aria-current");
    }
  });

  stageDots.forEach((dot) => {
    const current = dot.dataset.stage === currentStage;
    dot.classList.toggle("active", current);
    if (current) {
      dot.setAttribute("aria-current", "step");
    } else {
      dot.removeAttribute("aria-current");
    }
  });
}

function updateTimelineUI() {
  timelineScrubber.value = String(Math.round(playheadMs));

  let elapsed = playheadMs;
  let duration = TOTAL_CYCLE_MS;

  if (playbackMode === "stage" && loopStage) {
    const { start, end } = stageBounds(loopStage);
    elapsed = Math.max(0, playheadMs - start);
    duration = end - start;
  }

  currentTimeLabel.textContent = formatTime(elapsed);
  totalTimeLabel.textContent = formatTime(duration);
  timelineScrubber.setAttribute(
    "aria-valuetext",
    `${formatTime(elapsed)} of ${formatTime(duration)}, ${STAGES[currentStage].phase.title}`
  );
}

function setPlayhead(ms) {
  let next = Number(ms);
  if (!Number.isFinite(next)) next = 0;

  if (playbackMode === "stage" && loopStage) {
    const { start, end } = stageBounds(loopStage);
    next = Math.max(start, Math.min(end - 0.001, next));
  } else {
    next = Math.max(0, Math.min(TOTAL_CYCLE_MS, next));
  }

  playheadMs = next;
  currentStage = getStageAtPlayhead(playheadMs).name;
}

function updateInfo() {
  const stage = STAGES[currentStage];
  const phase = stage.phase;

  eventTitle.textContent = stage.title;
  eventSubtitle.textContent = stage.subtitle || "";
  eventSubtitle.hidden = !stage.subtitle;
  triggerText.textContent = stage.trigger || "";
  eventDescription.textContent = stage.description;
  phaseTitle.textContent = phase.title;
  phaseDescription.textContent = phase.description;
  watchText.textContent = phase.watch || "";
  flowText.textContent = phase.flow;

  setValve(tricuspidState, phase.tricuspid);
  setValve(mitralState, phase.mitral);
  setValve(pulmonaryState, phase.pulmonary);
  setValve(aorticState, phase.aortic);

  heartVisualDescription.textContent = `${phase.title}. ${phase.description} Valve states: tricuspid ${phase.tricuspid.toLowerCase()}, mitral ${phase.mitral.toLowerCase()}, pulmonary ${phase.pulmonary.toLowerCase()}, aortic ${phase.aortic.toLowerCase()}. ${phase.flow}`;
}

function updatePlayButton() {
  const target = playbackMode === "stage" && loopStage
    ? STAGES[loopStage].phase.title
    : "full cardiac cycle";

  playPauseBtn.textContent = playing ? "Pause" : "Play";
  playPauseBtn.setAttribute("aria-label", playing ? `Pause ${target}` : `Play ${target}`);
}

function render(force = false) {
  const position = getStageAtPlayhead(playheadMs);
  currentStage = position.name;

  const stage = position.stage;
  const localMs = position.localMs;
  const frameIndex = Math.max(0, Math.min(frames.length - 1, stage.frameAt(localMs)));

  if (frameIndex !== lastFrameIndex && drawHeart(frameIndex)) {
    lastFrameIndex = frameIndex;
  }

  flowCtx.clearRect(0, 0, flowCanvas.width, flowCanvas.height);

  if (currentStage === "isoContraction" || currentStage === "ejection") {
    drawConstantAtrialBlood();
  }

  stage.overlay(localMs);

  const infoKey = `${currentStage}|${playbackMode}|${loopStage ?? ""}`;
  if (force || infoKey !== lastInfoKey) {
    updateInfo();
    updateStageIndicators();
    updatePlayButton();
    lastInfoKey = infoKey;
  }

  updateTimelineUI();
}

function animate(now) {
  const delta = Math.min(100, now - lastTime);
  lastTime = now;

  if (playing) {
    if (playbackMode === "cycle") {
      playheadMs += delta * speed;
      if (playheadMs >= TOTAL_CYCLE_MS) {
        playheadMs %= TOTAL_CYCLE_MS;
      }
    } else if (loopStage) {
      const { start, end } = stageBounds(loopStage);
      const duration = end - start;

      if (playheadMs < start || playheadMs >= end) {
        playheadMs = start;
      }

      playheadMs += delta * speed;
      if (playheadMs >= end) {
        playheadMs = start + ((playheadMs - start) % duration);
      }
    }

    render();
  }

  requestAnimationFrame(animate);
}

function announceMode(message) {
  modeStatus.textContent = "";
  window.setTimeout(() => {
    modeStatus.textContent = message;
  }, 10);
}

async function setStage(stageName) {
  await ensureStageFrames(stageName);
  playbackMode = "stage";
  loopStage = stageName;
  setTimelineBounds();
  setPlayhead(stageBounds(stageName).start);
  playing = true;
  lastInfoKey = "";
  announceMode(`${STAGES[stageName].phase.title} selected. This stage will loop until Start is pressed.`);
  render(true);
}

function startFullCycle() {
  playbackMode = "cycle";
  loopStage = null;
  setTimelineBounds();
  setPlayhead(0);
  playing = true;
  lastInfoKey = "";
  announceMode("Full cardiac cycle mode selected.");
  render(true);
}

function movePlayheadBy(deltaMs) {
  if (playbackMode === "stage" && loopStage) {
    const { start, end } = stageBounds(loopStage);
    const duration = end - start;
    const local = ((playheadMs - start + deltaMs) % duration + duration) % duration;
    setPlayhead(start + local);
  } else {
    setPlayhead(Math.max(0, Math.min(TOTAL_CYCLE_MS, playheadMs + deltaMs)));
  }

  render(true);
}

playPauseBtn.addEventListener("click", () => {
  playing = !playing;
  updatePlayButton();
});

restartBtn.addEventListener("click", () => {
  if (playbackMode === "stage" && loopStage) {
    setPlayhead(stageBounds(loopStage).start);
  } else {
    setPlayhead(0);
  }
  render(true);
});

stepBackBtn.addEventListener("click", () => movePlayheadBy(-100));
stepForwardBtn.addEventListener("click", () => movePlayheadBy(100));

timelineScrubber.addEventListener("input", (event) => {
  setPlayhead(Number(event.target.value));
  render(true);
});

speedSelect.addEventListener("change", () => {
  speed = Number(speedSelect.value);
});

btnStart.addEventListener("click", startFullCycle);
btnAtrialSystole.addEventListener("click", () => setStage("atrialSystole"));
btnIsoContraction.addEventListener("click", () => setStage("isoContraction"));
btnEjection.addEventListener("click", () => setStage("ejection"));
btnIsoRelaxation.addEventListener("click", () => setStage("isoRelaxation"));
btnFilling.addEventListener("click", () => setStage("filling"));
stageDots.forEach((dot) => dot.addEventListener("click", () => setStage(dot.dataset.stage)));

document.addEventListener("keydown", (event) => {
  const interactive = event.target.closest?.("button, a, input, select, textarea, [contenteditable='true']");
  if (interactive) return;

  if (event.code === "Space") {
    event.preventDefault();
    playing = !playing;
    updatePlayButton();
  } else if (event.key === "ArrowLeft") {
    event.preventDefault();
    movePlayheadBy(-100);
  } else if (event.key === "ArrowRight") {
    event.preventDefault();
    movePlayheadBy(100);
  }
});

setTimelineBounds();
updateInfo();
updateStageIndicators();
updatePlayButton();
updateTimelineUI();

if (prefersReducedMotion) {
  announceMode("Reduced-motion preference detected. Animation is paused; press Play to begin.");
}

initializeFrames();
