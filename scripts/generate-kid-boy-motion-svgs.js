"use strict";

const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..");
const repoAssetsDir = path.join(repoRoot, "themes", "kid-boy", "assets");
const userAssetsDir = path.join(process.env.APPDATA || "", "clawd-on-desk", "themes", "kid-boy", "assets");
const targetDirs = [repoAssetsDir, userAssetsDir].filter(Boolean);

const CANVAS_W = 1254;
const CANVAS_H = 1484;

const ACTIONS = [
  {
    file: "kid-idle.svg",
    png: "kid-idle.png",
    title: "idle",
    imageClass: "scene-idle",
    overlays: `
      <g class="overlay bob">
        <image href="__IMAGE_REF__" x="0" y="0" width="${CANVAS_W}" height="${CANVAS_H}" preserveAspectRatio="none" />
      </g>
      <g class="overlay head-drift" clip-path="url(#idle-head)">
        <image href="__IMAGE_REF__" x="0" y="0" width="${CANVAS_W}" height="${CANVAS_H}" preserveAspectRatio="none" />
      </g>
    `,
    clips: `
      <clipPath id="idle-head"><rect x="260" y="120" width="750" height="520" rx="130" /></clipPath>
    `,
  },
  {
    file: "kid-working.svg",
    png: "kid-working.png",
    title: "working",
    imageClass: "scene-working",
    overlays: `
      <g class="overlay work-head" clip-path="url(#work-head)">
        <image href="__IMAGE_REF__" x="0" y="0" width="${CANVAS_W}" height="${CANVAS_H}" preserveAspectRatio="none" />
      </g>
      <g class="overlay work-left" clip-path="url(#work-left-arm)">
        <image href="__IMAGE_REF__" x="0" y="0" width="${CANVAS_W}" height="${CANVAS_H}" preserveAspectRatio="none" />
      </g>
      <g class="overlay work-right" clip-path="url(#work-right-arm)">
        <image href="__IMAGE_REF__" x="0" y="0" width="${CANVAS_W}" height="${CANVAS_H}" preserveAspectRatio="none" />
      </g>
      <g class="keyboard-hint">
        <rect x="392" y="838" width="466" height="128" rx="24" fill="#ffffff" opacity="0.06" />
        <rect x="414" y="860" width="422" height="86" rx="18" fill="#ffffff" opacity="0.08" />
        <g fill="#9ea8b9" opacity="0.52">
          <rect x="442" y="876" width="20" height="10" rx="5" />
          <rect x="474" y="876" width="20" height="10" rx="5" />
          <rect x="506" y="876" width="20" height="10" rx="5" />
          <rect x="538" y="876" width="20" height="10" rx="5" />
          <rect x="570" y="876" width="20" height="10" rx="5" />
          <rect x="602" y="876" width="20" height="10" rx="5" />
          <rect x="634" y="876" width="20" height="10" rx="5" />
          <rect x="666" y="876" width="20" height="10" rx="5" />
          <rect x="698" y="876" width="20" height="10" rx="5" />
        </g>
        <g fill="#9ea8b9" opacity="0.42">
          <rect x="458" y="902" width="20" height="10" rx="5" />
          <rect x="490" y="902" width="20" height="10" rx="5" />
          <rect x="522" y="902" width="20" height="10" rx="5" />
          <rect x="554" y="902" width="20" height="10" rx="5" />
          <rect x="586" y="902" width="20" height="10" rx="5" />
          <rect x="618" y="902" width="20" height="10" rx="5" />
          <rect x="650" y="902" width="20" height="10" rx="5" />
          <rect x="682" y="902" width="20" height="10" rx="5" />
        </g>
      </g>
      <g class="typing-sparks">
        <path d="M478 832 l-14 -18" fill="none" stroke="#a6b5d0" stroke-width="8" stroke-linecap="round" />
        <path d="M760 824 l14 -18" fill="none" stroke="#a6b5d0" stroke-width="8" stroke-linecap="round" />
        <path d="M548 822 l0 -20" fill="none" stroke="#a6b5d0" stroke-width="8" stroke-linecap="round" />
      </g>
    `,
    clips: `
      <clipPath id="work-head"><rect x="270" y="120" width="700" height="620" rx="120" /></clipPath>
      <clipPath id="work-left-arm"><rect x="330" y="770" width="260" height="280" rx="70" /></clipPath>
      <clipPath id="work-right-arm"><rect x="650" y="748" width="290" height="300" rx="70" /></clipPath>
    `,
  },
  {
    file: "kid-thinking.svg",
    png: "kid-thinking.png",
    title: "thinking",
    imageClass: "scene-thinking",
    overlays: `
      <g class="overlay think-head" clip-path="url(#think-head)">
        <image href="__IMAGE_REF__" x="0" y="0" width="${CANVAS_W}" height="${CANVAS_H}" preserveAspectRatio="none" />
      </g>
      <g class="thought-dots">
        <circle cx="846" cy="250" r="10" fill="#aab6cc" opacity="0.62" />
        <circle cx="884" cy="212" r="7" fill="#aab6cc" opacity="0.52" />
        <circle cx="918" cy="180" r="5" fill="#aab6cc" opacity="0.45" />
      </g>
    `,
    clips: `
      <clipPath id="think-head"><rect x="260" y="120" width="720" height="620" rx="120" /></clipPath>
    `,
  },
  {
    file: "kid-yawning.svg",
    png: "kid-yawning.png",
    title: "yawning",
    imageClass: "scene-yawning",
    overlays: `
      <g class="overlay yawn-head" clip-path="url(#yawn-head)">
        <image href="__IMAGE_REF__" x="0" y="0" width="${CANVAS_W}" height="${CANVAS_H}" preserveAspectRatio="none" />
      </g>
      <g class="overlay yawn-left" clip-path="url(#yawn-left-arm)">
        <image href="__IMAGE_REF__" x="0" y="0" width="${CANVAS_W}" height="${CANVAS_H}" preserveAspectRatio="none" />
      </g>
      <g class="overlay yawn-right" clip-path="url(#yawn-right-arm)">
        <image href="__IMAGE_REF__" x="0" y="0" width="${CANVAS_W}" height="${CANVAS_H}" preserveAspectRatio="none" />
      </g>
      <g class="yawn-lines">
        <path d="M318 238 C360 198, 398 194, 438 218" fill="none" stroke="#e4b075" stroke-width="12" stroke-linecap="round" opacity="0.6" />
        <path d="M816 228 C856 198, 894 194, 936 220" fill="none" stroke="#e4b075" stroke-width="12" stroke-linecap="round" opacity="0.48" />
      </g>
    `,
    clips: `
      <clipPath id="yawn-head"><rect x="250" y="110" width="760" height="680" rx="120" /></clipPath>
      <clipPath id="yawn-left-arm"><rect x="300" y="680" width="280" height="380" rx="80" /></clipPath>
      <clipPath id="yawn-right-arm"><rect x="660" y="680" width="280" height="380" rx="80" /></clipPath>
    `,
  },
  {
    file: "kid-sleeping.svg",
    png: "kid-sleeping.png",
    title: "sleeping",
    imageClass: "scene-sleeping",
    overlays: `
      <g class="overlay sleep-head" clip-path="url(#sleep-head)">
        <image href="__IMAGE_REF__" x="0" y="0" width="${CANVAS_W}" height="${CANVAS_H}" preserveAspectRatio="none" />
      </g>
      <g class="zzz-group">
        <text x="884" y="260" fill="#92a4c7" font-size="56" font-weight="700" font-family="Arial, sans-serif">Z</text>
        <text x="928" y="230" fill="#92a4c7" font-size="44" font-weight="700" font-family="Arial, sans-serif">Z</text>
        <text x="964" y="202" fill="#92a4c7" font-size="34" font-weight="700" font-family="Arial, sans-serif">Z</text>
      </g>
    `,
    clips: `
      <clipPath id="sleep-head"><rect x="250" y="120" width="760" height="620" rx="120" /></clipPath>
    `,
  },
  {
    file: "kid-attention.svg",
    png: "kid-attention.png",
    title: "attention",
    imageClass: "scene-attention",
    overlays: `
      <g class="overlay attention-head" clip-path="url(#attention-head)">
        <image href="__IMAGE_REF__" x="0" y="0" width="${CANVAS_W}" height="${CANVAS_H}" preserveAspectRatio="none" />
      </g>
      <g class="attention-marks">
        <path d="M973 236 L1002 204" fill="none" stroke="#f0a84b" stroke-width="12" stroke-linecap="round" />
        <path d="M1008 254 L1042 232" fill="none" stroke="#f0a84b" stroke-width="12" stroke-linecap="round" />
        <path d="M945 282 L972 262" fill="none" stroke="#f0a84b" stroke-width="12" stroke-linecap="round" />
      </g>
    `,
    clips: `
      <clipPath id="attention-head"><rect x="250" y="120" width="780" height="680" rx="120" /></clipPath>
    `,
  },
  {
    file: "kid-notification.svg",
    png: "kid-notification.png",
    title: "notification",
    imageClass: "scene-notification",
    overlays: `
      <g class="overlay notify-head" clip-path="url(#notify-head)">
        <image href="__IMAGE_REF__" x="0" y="0" width="${CANVAS_W}" height="${CANVAS_H}" preserveAspectRatio="none" />
      </g>
      <g class="notify-rings">
        <path d="M118 482 C164 456, 202 456, 246 482" fill="none" stroke="#9fb1d6" stroke-width="11" stroke-linecap="round" opacity="0.45" />
        <path d="M1008 482 C1054 456, 1092 456, 1136 482" fill="none" stroke="#9fb1d6" stroke-width="11" stroke-linecap="round" opacity="0.45" />
      </g>
    `,
    clips: `
      <clipPath id="notify-head"><rect x="250" y="120" width="780" height="680" rx="120" /></clipPath>
    `,
  },
  {
    file: "kid-error.svg",
    png: "kid-error.png",
    title: "error",
    imageClass: "scene-error",
    overlays: `
      <g class="overlay error-head" clip-path="url(#error-head)">
        <image href="__IMAGE_REF__" x="0" y="0" width="${CANVAS_W}" height="${CANVAS_H}" preserveAspectRatio="none" />
      </g>
      <g class="error-sweat">
        <path d="M415 414 C398 392, 396 370, 414 354 C434 372, 440 398, 415 414 Z" fill="#9ecdf2" opacity="0.88" />
      </g>
    `,
    clips: `
      <clipPath id="error-head"><rect x="250" y="120" width="780" height="680" rx="120" /></clipPath>
    `,
  },
  {
    file: "kid-react-drag.svg",
    png: "kid-react-drag.png",
    title: "drag",
    imageClass: "scene-drag",
    overlays: `
      <g class="overlay drag-head" clip-path="url(#drag-head)">
        <image href="__IMAGE_REF__" x="0" y="0" width="${CANVAS_W}" height="${CANVAS_H}" preserveAspectRatio="none" />
      </g>
      <g class="drag-lines">
        <path d="M140 844 L258 776" fill="none" stroke="#bac4d3" stroke-width="10" stroke-linecap="round" opacity="0.45" />
        <path d="M152 920 L292 868" fill="none" stroke="#bac4d3" stroke-width="10" stroke-linecap="round" opacity="0.35" />
      </g>
    `,
    clips: `
      <clipPath id="drag-head"><rect x="250" y="120" width="780" height="680" rx="120" /></clipPath>
    `,
  },
];

function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function getImageRef(assetDir, pngName) {
  const pngPath = path.join(assetDir, pngName);
  const pngBytes = fs.readFileSync(pngPath);
  return `data:image/png;base64,${pngBytes.toString("base64")}`;
}

function buildSvg(action, imageRef) {
  const css = `
    .scene {
      overflow: visible;
    }
    .overlay {
      transform-box: fill-box;
      transform-origin: center;
      will-change: transform, opacity;
    }
    .bob { animation: idleBob 4.5s ease-in-out infinite; opacity: 1; }
    .head-drift { animation: idleHead 4.5s ease-in-out infinite; }
    .work-head { animation: workHead 1.15s ease-in-out infinite; }
    .work-left { animation: workLeft 0.38s ease-in-out infinite alternate; animation-delay: -0.12s; }
    .work-right { animation: workRight 0.32s ease-in-out infinite alternate; }
    .keyboard-hint { animation: keyPulse 0.38s ease-in-out infinite alternate; }
    .typing-sparks { animation: sparkPulse 0.38s ease-in-out infinite alternate; }
    .think-head { animation: thinkHead 1.9s ease-in-out infinite; }
    .thought-dots { animation: thoughtDots 1.9s ease-in-out infinite; }
    .yawn-head { animation: yawnHead 2.8s ease-in-out infinite; }
    .yawn-left { animation: yawnLeft 2.8s ease-in-out infinite; }
    .yawn-right { animation: yawnRight 2.8s ease-in-out infinite; }
    .yawn-lines { animation: yawnLines 2.8s ease-in-out infinite; }
    .sleep-head { animation: sleepHead 3.8s ease-in-out infinite; }
    .zzz-group { animation: zzzFloat 3.8s ease-in-out infinite; }
    .attention-head { animation: attentionHead 1.6s ease-in-out infinite; }
    .attention-marks { animation: attentionMarks 1.6s ease-in-out infinite; }
    .notify-head { animation: notifyShake 1.0s ease-in-out infinite; }
    .notify-rings { animation: notifyRings 1.0s ease-in-out infinite; }
    .error-head { animation: errorWobble 0.85s ease-in-out infinite; }
    .error-sweat { animation: errorSweat 1.2s ease-in-out infinite; }
    .drag-head { animation: dragSwing 0.95s ease-in-out infinite; }
    .drag-lines { animation: dragLines 0.95s ease-in-out infinite; }
    @keyframes idleBob {
      0%, 100% { transform: translateY(0px); }
      50% { transform: translateY(-8px); }
    }
    @keyframes idleHead {
      0%, 100% { transform: translateY(0px) rotate(0deg); }
      50% { transform: translateY(-2px) rotate(-0.6deg); }
    }
    @keyframes workHead {
      0%, 100% { transform: translateY(0px) rotate(0deg); }
      50% { transform: translateY(3px) rotate(1deg); }
    }
    @keyframes workLeft {
      0% { transform: translate(0px, 0px) rotate(-2deg); }
      100% { transform: translate(10px, 6px) rotate(8deg); }
    }
    @keyframes workRight {
      0% { transform: translate(0px, 0px) rotate(2deg); }
      100% { transform: translate(-8px, 5px) rotate(-7deg); }
    }
    @keyframes keyPulse {
      0%, 100% { opacity: 0.5; transform: translateY(0px) scale(1); }
      50% { opacity: 0.9; transform: translateY(2px) scale(1.015); }
    }
    @keyframes sparkPulse {
      0%, 100% { opacity: 0.15; }
      50% { opacity: 1; }
    }
    @keyframes thinkHead {
      0%, 100% { transform: translateY(0px) rotate(0deg); }
      50% { transform: translateY(-4px) rotate(-1.8deg); }
    }
    @keyframes thoughtDots {
      0%, 100% { opacity: 0.25; transform: translateY(0px); }
      50% { opacity: 1; transform: translateY(-8px); }
    }
    @keyframes yawnHead {
      0%, 100% { transform: translateY(0px) scale(1); }
      50% { transform: translateY(-8px) scale(1.01); }
    }
    @keyframes yawnLeft {
      0%, 100% { transform: translate(0px, 0px) rotate(-2deg); }
      50% { transform: translate(-18px, -8px) rotate(-24deg); }
    }
    @keyframes yawnRight {
      0%, 100% { transform: translate(0px, 0px) rotate(2deg); }
      50% { transform: translate(18px, -8px) rotate(26deg); }
    }
    @keyframes yawnLines {
      0%, 100% { opacity: 0.2; transform: translateX(0px); }
      50% { opacity: 0.8; transform: translateX(8px); }
    }
    @keyframes sleepHead {
      0%, 100% { transform: translateY(0px) rotate(0deg); }
      50% { transform: translateY(-5px) rotate(1deg); }
    }
    @keyframes zzzFloat {
      0%, 100% { opacity: 0; transform: translateY(0px); }
      30% { opacity: 0.75; }
      50% { opacity: 1; transform: translateY(-10px); }
      80% { opacity: 0; transform: translateY(-18px); }
    }
    @keyframes attentionHead {
      0%, 100% { transform: translateY(0px) rotate(0deg); }
      50% { transform: translateY(-8px) rotate(-2deg); }
    }
    @keyframes attentionMarks {
      0%, 100% { opacity: 0.2; transform: scale(0.95); }
      50% { opacity: 1; transform: scale(1.08); }
    }
    @keyframes notifyShake {
      0%, 100% { transform: translateX(0px) rotate(0deg); }
      20% { transform: translateX(-7px) rotate(-1deg); }
      40% { transform: translateX(7px) rotate(1deg); }
      60% { transform: translateX(-5px) rotate(-0.6deg); }
      80% { transform: translateX(4px) rotate(0.6deg); }
    }
    @keyframes notifyRings {
      0%, 100% { opacity: 0.1; transform: scale(1); }
      50% { opacity: 1; transform: scale(1.08); }
    }
    @keyframes errorWobble {
      0%, 100% { transform: translateX(0px) rotate(0deg); }
      20% { transform: translateX(-6px) rotate(-0.8deg); }
      40% { transform: translateX(5px) rotate(0.9deg); }
      60% { transform: translateX(-4px) rotate(-0.5deg); }
      80% { transform: translateX(3px) rotate(0.5deg); }
    }
    @keyframes errorSweat {
      0%, 100% { opacity: 0.18; transform: translateY(0px); }
      50% { opacity: 1; transform: translateY(8px); }
    }
    @keyframes dragSwing {
      0%, 100% { transform: translateX(0px) rotate(0deg); }
      50% { transform: translateX(-16px) rotate(-6deg); }
    }
    @keyframes dragLines {
      0%, 100% { opacity: 0.12; }
      50% { opacity: 0.7; }
    }
    @media (prefers-reduced-motion: reduce) {
      .overlay,
      .bob,
      .head-drift,
      .work-head,
      .work-left,
      .work-right,
      .keyboard-hint,
      .typing-sparks,
      .think-head,
      .thought-dots,
      .yawn-head,
      .yawn-left,
      .yawn-right,
      .yawn-lines,
      .sleep-head,
      .zzz-group,
      .attention-head,
      .attention-marks,
      .notify-head,
      .notify-rings,
      .error-head,
      .error-sweat,
      .drag-head,
      .drag-lines {
        animation: none !important;
      }
    }
  `;

  const baseImage = `<image href="${imageRef}" x="0" y="0" width="${CANVAS_W}" height="${CANVAS_H}" preserveAspectRatio="none" />`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${CANVAS_W} ${CANVAS_H}" width="${CANVAS_W}" height="${CANVAS_H}" role="img" aria-label="${escapeXml(action.title)}" class="${action.imageClass}">
  <title>${escapeXml(action.title)}</title>
  <style><![CDATA[${css}]]></style>
  ${action.clips}
  ${baseImage}
  ${action.overlays.replaceAll("__IMAGE_REF__", imageRef)}
</svg>
`;
}

function main() {
  for (const dir of targetDirs) {
    fs.mkdirSync(dir, { recursive: true });
  }

  for (const action of ACTIONS) {
    for (const dir of targetDirs) {
      const imageRef = getImageRef(dir, action.png);
      const svg = buildSvg(action, imageRef);
      fs.writeFileSync(path.join(dir, action.file), svg, "utf8");
    }
    console.log(`wrote ${action.file}`);
  }
}

main();
