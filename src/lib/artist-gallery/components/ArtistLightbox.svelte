<script lang="ts">
  import { fade } from "svelte/transition";
  import type { ArtistEntry } from "../types.js";

  interface Props {
    entry: ArtistEntry;
    onclose: () => void;
    /** Optional integrator hook: "Insert tag into prompt" action. */
    oninsertTag?: (tag: string) => void;
    onprev?: () => void;
    onnext?: () => void;
    zoom?: number;
    origin?: { x: number; y: number } | null;
  }

  let { entry, onclose, oninsertTag, onprev, onnext, zoom = $bindable(1), origin = null }: Props = $props();

  type Pt = { x: number; y: number } | null | undefined;

  function fromCard(node: Element, { origin: o }: { origin: Pt }) {
    const rect = node.getBoundingClientRect();
    const ox = o ? o.x - rect.left : rect.width / 2;
    const oy = o ? o.y - rect.top : rect.height / 2;
    return {
      duration: 450,
      css: (t: number) => {
        const c4 = (2 * Math.PI) / 3;
        const s = t === 0 ? 0 : t === 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
        return `transform-origin: ${ox}px ${oy}px; transform: scale(${s}); opacity: ${Math.min(1, t * 4)};`;
      }
    };
  }

  function toCard(node: Element, { origin: o }: { origin: Pt }) {
    const rect = node.getBoundingClientRect();
    const ox = o ? o.x - rect.left : rect.width / 2;
    const oy = o ? o.y - rect.top : rect.height / 2;
    return {
      duration: 220,
      css: (t: number) => `transform-origin: ${ox}px ${oy}px; transform: scale(${t * t}); opacity: ${t};`
    };
  }

  let imgEl = $state<HTMLImageElement | null>(null);
  let infoBarEl = $state<HTMLDivElement | null>(null);

  function cycleZoom(e: MouseEvent) {
    e.stopPropagation();
    if (zoom > 1) {
      zoom = 1;
      return;
    }
    const target = 1.5;
    if (imgEl) {
      const { width, height } = imgEl.getBoundingClientRect();
      // Reserve vertical space for the info bar + gap + wrapper padding
      // so zooming never pushes elements off screen.
      const infoH = infoBarEl?.getBoundingClientRect().height ?? 0;
      const reservedV = infoH + 12 /* gap */ + 32 /* wrapper padding top+bottom */;
      const availH = Math.max(0, window.innerHeight - reservedV);
      const availW = window.innerWidth * 0.92; // matches max-w-[92vw] wrapper cap
      const maxZoom = Math.min(availW / width, availH / height);
      zoom = Math.min(target, Math.max(1, maxZoom));
    } else {
      zoom = target;
    }
  }

  function displayTag(tag: string): string {
    return tag.replace(/^@/, "").replace(/_/g, " ");
  }

  function onBackdropKey(e: KeyboardEvent) {
    if (e.key === "Escape") onclose();
    if (e.key === "ArrowLeft") { e.preventDefault(); onprev?.(); }
    if (e.key === "ArrowRight") { e.preventDefault(); onnext?.(); }
  }

  async function copyTag() {
    try {
      await navigator.clipboard.writeText(entry.tag);
    } catch {
      // no-op; clipboard may be unavailable in some contexts
    }
  }
</script>

<svelte:window onkeydown={onBackdropKey} />

<div
  transition:fade={{ duration: 200 }}
  class="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
  role="dialog"
  aria-modal="true"
  aria-label={`Artist preview: ${entry.tag}`}
>
  <button
    type="button"
    class="absolute inset-0 h-full w-full cursor-default"
    aria-label="Close"
    onclick={onclose}
  ></button>

  <div
    in:fromCard={{ origin }}
    out:toCard={{ origin }}
    class="relative z-10 flex w-auto max-w-[92vw] max-h-[92vh] flex-col items-center gap-3 p-4">
    {#if onprev}
      <button
        type="button"
        onclick={onprev}
        class="absolute -left-12 top-1/2 -translate-y-1/2 flex h-10 w-10 items-center justify-center rounded-full border border-neutral-700 bg-neutral-900/90 text-neutral-200 transition-colors hover:border-indigo-500 hover:text-white focus:outline-none"
        aria-label="Previous artist"
      >
        ←
      </button>
    {/if}
    {#if onnext}
      <button
        type="button"
        onclick={onnext}
        class="absolute -right-12 top-1/2 -translate-y-1/2 flex h-10 w-10 items-center justify-center rounded-full border border-neutral-700 bg-neutral-900/90 text-neutral-200 transition-colors hover:border-indigo-500 hover:text-white focus:outline-none"
        aria-label="Next artist"
      >
        →
      </button>
    {/if}
    {#if entry.hasImage && entry.imageUrl}
      <div class="relative flex min-h-0 flex-1 items-center justify-center">
        <button
          type="button"
          onclick={cycleZoom}
          style="zoom: {zoom}; transition: zoom 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);"
          class="flex h-full min-h-0 items-center {zoom > 1 ? 'cursor-zoom-out' : 'cursor-zoom-in'} focus:outline-none"
          aria-label="{zoom > 1 ? 'Zoom out' : 'Zoom in'}"
          title="{zoom > 1 ? 'Click to zoom out' : 'Click to zoom in'}"
        >
          <img
            bind:this={imgEl}
            src={entry.imageUrl}
            alt={entry.tag}
            class="h-full max-h-full max-w-full w-auto rounded-lg border border-neutral-800 object-contain shadow-2xl"
          />
        </button>
      </div>
    {:else}
      <div
        class="flex aspect-3/4 min-h-0 flex-1 items-center justify-center rounded-lg border border-neutral-800 bg-neutral-900 text-sm text-neutral-500"
      >
        no preview available
      </div>
    {/if}

    <div
      bind:this={infoBarEl}
      class="w-full shrink-0 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-neutral-800 bg-neutral-900/90 px-4 py-3"
    >
      <div class="min-w-0 flex-1">
        <a
          href="https://danbooru.donmai.us/artists/show_or_new?name={encodeURIComponent(entry.tag.replace(/^@/, ''))}"
          target="_blank"
          rel="noopener noreferrer"
          class="block truncate text-base font-medium text-red-400 hover:underline"
        >
          {displayTag(entry.tag)}
        </a>
        <div class="mt-0.5 text-xs text-neutral-500">
          {entry.postCount.toLocaleString()} posts
          {#if entry.aliases.length > 0}
            · aliases: {entry.aliases.map((a) => a.replace(/^@/, "")).join(", ")}
          {/if}
        </div>
      </div>
      <div class="flex shrink-0 gap-2">
        <button
          type="button"
          class="rounded-md border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-xs text-neutral-200 transition-colors hover:border-indigo-500 hover:bg-neutral-700"
          onclick={copyTag}
        >
          Copy tag
        </button>
        {#if oninsertTag}
          <button
            type="button"
            class="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-indigo-500"
            onclick={() => oninsertTag?.("@" + entry.tag.replace(/^@/, ""))}
          >
            Insert into prompt
          </button>
        {/if}
        <button
          type="button"
          class="rounded-md border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-xs text-neutral-200 transition-colors hover:border-neutral-500"
          onclick={onclose}
        >
          Close
        </button>
      </div>
    </div>
  </div>
</div>
