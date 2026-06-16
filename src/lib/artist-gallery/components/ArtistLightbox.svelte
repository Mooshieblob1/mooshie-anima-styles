<script lang="ts">
  import { fade } from "svelte/transition";
  import { formatCopiedTag } from "../tags.js";
  import type { ArtistEntry } from "../types.js";

  interface Props {
    entry: ArtistEntry;
    onclose: () => void;
    /** Optional integrator hook: "Insert tag into prompt" action. */
    oninsertTag?: (tag: string) => void;
    onprev?: () => void;
    onnext?: () => void;
    zoom?: number;
  }

  let { entry, onclose, oninsertTag, onprev, onnext, zoom = $bindable(1) }: Props = $props();

  // CSS `zoom` (unlike transform: scale) participates in layout, so the
  // enlarged image grows the scrollable column and the info bar reflows to sit
  // directly below it — never overlapped. Click toggles between fit and 1.8×.
  function cycleZoom(e: MouseEvent) {
    e.stopPropagation();
    zoom = zoom > 1 ? 1 : 1.8;
  }

  function displayTag(tag: string): string {
    return tag.replace(/^@/, "").replace(/_/g, " ");
  }

  function displayPostCount(entry: ArtistEntry): string {
    return entry.belowThreshold ? "≤50" : entry.postCount.toLocaleString();
  }

  function onBackdropKey(e: KeyboardEvent) {
    if (e.key === "Escape") onclose();
    if (e.key === "ArrowLeft") { e.preventDefault(); onprev?.(); }
    if (e.key === "ArrowRight") { e.preventDefault(); onnext?.(); }
  }

  async function copyTag() {
    try {
      await navigator.clipboard.writeText(formatCopiedTag(entry.tag));
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

  {#if onprev}
    <button
      type="button"
      onclick={onprev}
      class="absolute left-3 top-1/2 z-20 -translate-y-1/2 flex items-center justify-center rounded-full border-2 border-neutral-400 bg-neutral-800 text-white shadow-lg transition-colors hover:border-indigo-400 hover:bg-neutral-700 focus:outline-none"
      style="width: clamp(2.5rem, 2.5vw, 4rem); height: clamp(2.5rem, 2.5vw, 4rem); font-size: clamp(1.1rem, 1.4vw, 1.8rem);"
      aria-label="Previous artist"
    >
      ←
    </button>
  {/if}
  {#if onnext}
    <button
      type="button"
      onclick={onnext}
      class="absolute right-3 top-1/2 z-20 -translate-y-1/2 flex items-center justify-center rounded-full border-2 border-neutral-400 bg-neutral-800 text-white shadow-lg transition-colors hover:border-indigo-400 hover:bg-neutral-700 focus:outline-none"
      style="width: clamp(2.5rem, 2.5vw, 4rem); height: clamp(2.5rem, 2.5vw, 4rem); font-size: clamp(1.1rem, 1.4vw, 1.8rem);"
      aria-label="Next artist"
    >
      →
    </button>
  {/if}

  <div
    transition:fade={{ duration: 150 }}
    class="relative z-10 flex w-auto max-w-[92vw] max-h-[92vh] flex-col items-center gap-3 overflow-auto p-4">
    {#if entry.hasImage && entry.imageUrl}
      <button
        type="button"
        onclick={cycleZoom}
        style="zoom: {zoom}; transition: zoom 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);"
        class="block shrink-0 {zoom > 1 ? 'cursor-zoom-out' : 'cursor-zoom-in'} focus:outline-none"
        aria-label="{zoom > 1 ? 'Zoom out' : 'Zoom in'}"
        title="{zoom > 1 ? 'Click to zoom out' : 'Click to zoom in'}"
      >
        <img
          src={entry.imageUrl}
          alt={entry.tag}
          class="block max-h-[78vh] max-w-[88vw] w-auto rounded-lg border border-neutral-800 object-contain shadow-2xl"
        />
      </button>
    {:else}
      <div
        class="flex aspect-3/4 h-[70vh] shrink-0 items-center justify-center rounded-lg border border-neutral-800 bg-neutral-900 text-sm text-neutral-500"
      >
        no preview available
      </div>
    {/if}

    <div
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
          {displayPostCount(entry)} posts
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
            onclick={() => oninsertTag?.(formatCopiedTag(entry.tag))}
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
