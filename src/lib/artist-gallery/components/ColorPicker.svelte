<script lang="ts">
  interface Props {
    value: string;
    onchange: (color: string) => void;
  }

  let { value = "#818cf8", onchange }: Props = $props();

  const PRESETS = [
    "#818cf8","#f472b6","#34d399","#fbbf24",
    "#60a5fa","#f87171","#a78bfa","#2dd4bf",
    "#e879f9","#22d3ee","#fb923c","#4ade80",
  ];

  // ── Colour math ─────────────────────────────────────────────────────────────

  function hexToRgb(hex: string): [number, number, number] {
    const h = hex.replace("#", "").padEnd(6, "0");
    return [
      parseInt(h.slice(0, 2), 16) || 0,
      parseInt(h.slice(2, 4), 16) || 0,
      parseInt(h.slice(4, 6), 16) || 0,
    ];
  }

  function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const d = max - min;
    let h = 0;
    if (d) {
      if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
      else if (max === g) h = ((b - r) / d + 2) / 6;
      else h = ((r - g) / d + 4) / 6;
    }
    return [h * 360, max ? d / max : 0, max];
  }

  function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
    const hn = h / 360;
    const i = Math.floor(hn * 6);
    const f = hn * 6 - i;
    const p = v * (1 - s);
    const q = v * (1 - f * s);
    const t = v * (1 - (1 - f) * s);
    let r = 0, g = 0, b = 0;
    switch (i % 6) {
      case 0: r = v; g = t; b = p; break;
      case 1: r = q; g = v; b = p; break;
      case 2: r = p; g = v; b = t; break;
      case 3: r = p; g = q; b = v; break;
      case 4: r = t; g = p; b = v; break;
      case 5: r = v; g = p; b = q; break;
    }
    return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
  }

  function toHex(r: number, g: number, b: number): string {
    return "#" + [r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("");
  }

  // ── State ────────────────────────────────────────────────────────────────────

  let open = $state(false);
  let triggerEl = $state<HTMLButtonElement | null>(null);
  let panelEl = $state<HTMLDivElement | null>(null);
  let pickerEl = $state<HTMLDivElement | null>(null);
  let hueEl = $state<HTMLDivElement | null>(null);
  let panelPos = $state({ top: 0, left: 0 });

  // Initialise with a placeholder — $effect sets real values before first interaction
  let hue = $state(0);
  let sat = $state(0);
  let bri = $state(1);
  let hexText = $state("#000000");
  // Plain (non-reactive) guard prevents the $effect from re-applying our own emissions
  let lastEmitted = "#";

  $effect(() => {
    const v = value;
    if (v !== lastEmitted) {
      const [nh, ns, nv] = rgbToHsv(...hexToRgb(v));
      hue = nh; sat = ns; bri = nv;
      hexText = v;
      lastEmitted = v;
    }
  });

  const currHex = $derived(toHex(...hsvToRgb(hue, sat, bri)));
  const hueColor = $derived(`hsl(${hue},100%,50%)`);
  const svLeft = $derived(sat * 100);
  const svTop = $derived((1 - bri) * 100);
  const hueLeft = $derived((hue / 360) * 100);

  function emit() {
    const hex = currHex;
    lastEmitted = hex;
    hexText = hex;
    onchange(hex);
  }

  // ── Panel positioning ────────────────────────────────────────────────────────

  function toggle() {
    if (open) { open = false; return; }
    if (triggerEl) {
      const r = triggerEl.getBoundingClientRect();
      const panelH = 268;
      const panelW = 216;
      const left = Math.min(r.left, window.innerWidth - panelW - 8);
      const top = r.bottom + panelH + 8 > window.innerHeight
        ? Math.max(8, r.top - panelH - 4)
        : r.bottom + 4;
      panelPos = { top, left };
    }
    open = true;
  }

  function onOutsideClick(e: MouseEvent) {
    if (!open) return;
    const t = e.target as Node;
    if (triggerEl?.contains(t) || panelEl?.contains(t)) return;
    open = false;
  }

  // ── SV picker drag ───────────────────────────────────────────────────────────

  function onSVDown(e: PointerEvent) {
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    moveSV(e);
  }

  function onSVMove(e: PointerEvent) {
    if (!e.buttons) return;
    moveSV(e);
  }

  function moveSV(e: PointerEvent) {
    if (!pickerEl) return;
    const r = pickerEl.getBoundingClientRect();
    sat = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    bri = 1 - Math.max(0, Math.min(1, (e.clientY - r.top) / r.height));
    emit();
  }

  // ── Hue drag ─────────────────────────────────────────────────────────────────

  function onHueDown(e: PointerEvent) {
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    moveHue(e);
  }

  function onHueMove(e: PointerEvent) {
    if (!e.buttons) return;
    moveHue(e);
  }

  function moveHue(e: PointerEvent) {
    if (!hueEl) return;
    const r = hueEl.getBoundingClientRect();
    hue = Math.max(0, Math.min(360, ((e.clientX - r.left) / r.width) * 360));
    emit();
  }

  // ── Hex input ─────────────────────────────────────────────────────────────────

  function onHexInput(e: Event) {
    let str = (e.target as HTMLInputElement).value.trim();
    if (!str.startsWith("#")) str = "#" + str;
    if (/^#[0-9a-fA-F]{6}$/.test(str)) {
      const [nh, ns, nv] = rgbToHsv(...hexToRgb(str));
      hue = nh; sat = ns; bri = nv;
      emit();
    }
  }

  function pickPreset(hex: string) {
    const [nh, ns, nv] = rgbToHsv(...hexToRgb(hex));
    hue = nh; sat = ns; bri = nv;
    emit();
  }
</script>

<svelte:document onclick={onOutsideClick} />

<button
  bind:this={triggerEl}
  type="button"
  onclick={toggle}
  class="h-7 w-7 shrink-0 cursor-pointer rounded border-2 border-neutral-700 transition-colors hover:border-neutral-500 focus:outline-none focus:border-indigo-500"
  style="background-color: {value};"
  title="Pick colour"
  aria-label="Pick colour"
></button>

{#if open}
  <div
    bind:this={panelEl}
    class="fixed z-200 w-54 rounded-xl border border-neutral-700 bg-neutral-900 p-3 shadow-2xl"
    style="top: {panelPos.top}px; left: {panelPos.left}px;"
    role="dialog"
    aria-label="Colour picker"
  >
    <!-- SV area -->
    <div
      bind:this={pickerEl}
      class="relative mb-2.5 h-28 w-full cursor-crosshair select-none overflow-hidden rounded-lg touch-none"
      style="background: linear-gradient(to bottom, transparent, #000), linear-gradient(to right, #fff, {hueColor});"
      onpointerdown={onSVDown}
      onpointermove={onSVMove}
      role="presentation"
    >
      <div
        class="pointer-events-none absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.5)]"
        style="left: {svLeft}%; top: {svTop}%; background-color: {currHex};"
      ></div>
    </div>

    <!-- Hue strip -->
    <div
      bind:this={hueEl}
      class="relative mb-3 h-3.5 w-full cursor-pointer select-none overflow-hidden rounded-full touch-none"
      style="background: linear-gradient(to right,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00);"
      onpointerdown={onHueDown}
      onpointermove={onHueMove}
      role="presentation"
    >
      <div
        class="pointer-events-none absolute top-1/2 h-5 w-3 -translate-x-1/2 -translate-y-1/2 rounded border-2 border-white shadow-md"
        style="left: {hueLeft}%; background-color: {hueColor};"
      ></div>
    </div>

    <!-- Presets grid -->
    <div class="mb-2.5 grid grid-cols-6 gap-1">
      {#each PRESETS as p (p)}
        <button
          type="button"
          onclick={() => pickPreset(p)}
          class="h-6 w-full rounded border-2 transition-transform hover:scale-110 {currHex.toLowerCase() === p.toLowerCase() ? 'border-white scale-110' : 'border-transparent'}"
          style="background-color: {p};"
          title={p}
        ></button>
      {/each}
    </div>

    <!-- Hex input -->
    <div class="flex items-center gap-2">
      <div class="h-6 w-6 shrink-0 rounded border border-neutral-700" style="background-color: {currHex};"></div>
      <input
        type="text"
        value={hexText}
        oninput={onHexInput}
        maxlength={7}
        spellcheck={false}
        class="flex-1 rounded border border-neutral-700 bg-neutral-800 px-2 py-1 font-mono text-xs uppercase text-neutral-200 focus:border-indigo-500 focus:outline-none"
        placeholder="#000000"
      />
    </div>
  </div>
{/if}
