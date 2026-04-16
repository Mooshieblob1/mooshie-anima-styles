<script lang="ts">
  import { onMount } from "svelte";
  import { createArtistGalleryStore } from "../store.svelte.js";
  import type { ArtistEntry, ArtistSearchHit } from "../types.js";
  import ArtistLightbox from "./ArtistLightbox.svelte";

  interface Props {
    manifestUrl: string;
    /** Optional integrator hook for "Insert tag into prompt" in the lightbox. */
    oninsertTag?: (tag: string) => void;
  }

  let { manifestUrl, oninsertTag }: Props = $props();

  const store = createArtistGalleryStore(manifestUrl);

  type SortField = "postCount" | "name" | "uniqueness";
  type SortDir = "asc" | "desc";
  type PageSize = 25 | 50 | 100;

  // ---------------------------------------------------------------------------
  // Uniqueness scoring
  // ---------------------------------------------------------------------------
  // Log-normal distribution centred at exp(5.5) ≈ 245 posts, sigma=1.8 in log
  // space. Artists with 50–2 000 posts score highest; mega-popular (10k+) and
  // tiny (<10) score low — the "hidden gem" sweet spot.
  function logNormalScore(x: number, mu: number, sigma: number): number {
    if (x <= 0) return 0;
    const lx = Math.log(x);
    return Math.exp(-0.5 * ((lx - mu) / sigma) ** 2);
  }

  function baseUniqueness(postCount: number): number {
    return logNormalScore(postCount, 5.5, 1.8);
  }

  let uniquenessJitter = $state<Float32Array>(new Float32Array(0));

  function generateJitter(count: number): Float32Array {
    const arr = new Float32Array(count);
    for (let i = 0; i < count; i++) arr[i] = 0.7 + 0.6 * Math.random();
    return arr;
  }

  function rotateUniqueness() {
    uniquenessJitter = generateJitter(allEntries.length);
    sortField = "uniqueness";
    currentPage = 1;
    requestAnimationFrame(() => {
      scrollContainer?.scrollTo({ top: 0, behavior: "instant" });
      scrollContainer?.dispatchEvent(new Event("scroll"));
    });
  }

  let allEntries = $state<ArtistSearchHit[]>([]);
  let allLoading = $state(false);
  let allError = $state<string | null>(null);

  let sortField = $state<SortField>("postCount");
  let sortDir = $state<SortDir>("desc");
  const PAGE_SIZES: PageSize[] = [25, 50, 100];
  let pageSize = $state<PageSize>(50);
  let currentPage = $state(1);

  let active = $state<ArtistEntry | null>(null);
  let activeIndex = $state(-1);
  let queryInput = $state("");
  let searchDebounce: number | null = null;
  let showSuggestions = $state(false);

  onMount(() => {
    store.init().then(async () => {
      allLoading = true;
      allError = null;
      try {
        allEntries = await store.client.loadSearchIndex();
        uniquenessJitter = generateJitter(allEntries.length);
      } catch (err) {
        allError = err instanceof Error ? err.message : String(err);
      } finally {
        allLoading = false;
      }
    });
  });

  function onSearchInput(value: string) {
    queryInput = value;
    showSuggestions = true;
    if (searchDebounce !== null) window.clearTimeout(searchDebounce);
    searchDebounce = window.setTimeout(() => {
      void store.setQuery(value);
      searchDebounce = null;
    }, 120);
  }

  function onInputFocus() {
    if (queryInput.trim()) showSuggestions = true;
  }

  function onInputBlur() {
    window.setTimeout(() => { showSuggestions = false; }, 150);
  }

  async function openHit(slug: string, index = -1) {
    await store.openArtist(slug);
    active = store.activeArtist;
    activeIndex = index;
    showSuggestions = false;
    queryInput = "";
    void store.setQuery("");
  }

  async function navigateTo(index: number) {
    const clamped = Math.max(0, Math.min(pageEntries.length - 1, index));
    await openHit(pageEntries[clamped].slug, clamped);
  }

  function closeLightbox() {
    active = null;
    activeIndex = -1;
    store.closeArtist();
  }

  function thumbUrl(hit: ArtistSearchHit): string {
    if (!store.manifest || !hit.hasImage || !hit.imageId) return "";
    return `${store.manifest.imageBaseUrl}/${store.manifest.releasePrefix}/images/${hit.imageId}.webp`;
  }

  function formatCount(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
    return String(n);
  }

  function displayTag(tag: string): string {
    return tag.replace(/^@/, "").replace(/_/g, " ");
  }

  let copiedSlug = $state<string | null>(null);

  async function copyTag(tag: string, slug: string) {
    const formatted = "@" + tag.replace(/^@/, "");
    await navigator.clipboard.writeText(formatted);
    copiedSlug = slug;
    window.setTimeout(() => { copiedSlug = null; }, 1500);
  }

  let scrollContainer = $state<HTMLDivElement | null>(null);

  function goToPage(page: number) {
    currentPage = page;
    requestAnimationFrame(() => {
      scrollContainer?.scrollTo({ top: 0, behavior: "instant" });
      scrollContainer?.dispatchEvent(new Event("scroll"));
    });
  }

  function setSort(field: SortField) {
    if (field === "uniqueness" && sortField !== "uniqueness") {
      rotateUniqueness();
      return;
    }
    sortField = field;
    currentPage = 1;
    requestAnimationFrame(() => {
      scrollContainer?.scrollTo({ top: 0, behavior: "instant" });
      scrollContainer?.dispatchEvent(new Event("scroll"));
    });
  }

  function setDir(dir: SortDir) {
    sortDir = dir;
    currentPage = 1;
    requestAnimationFrame(() => {
      scrollContainer?.scrollTo({ top: 0, behavior: "instant" });
      scrollContainer?.dispatchEvent(new Event("scroll"));
    });
  }

  function setPageSize(size: PageSize) {
    const firstIndex = (safePage - 1) * pageSize;
    pageSize = size;
    currentPage = Math.max(1, Math.floor(firstIndex / size) + 1);
    requestAnimationFrame(() => {
      scrollContainer?.dispatchEvent(new Event("scroll"));
    });
  }

  const sortedEntries = $derived.by(() => {
    if (sortField === "uniqueness") {
      const jitter = uniquenessJitter;
      return [...allEntries]
        .map((e, i) => ({ e, score: baseUniqueness(e.postCount) * (jitter[i] ?? 1) }))
        .sort((a, b) => b.score - a.score)
        .map((x) => x.e);
    }
    const dir = sortDir === "asc" ? 1 : -1;
    return [...allEntries].sort((a, b) =>
      sortField === "name"
        ? a.slug.localeCompare(b.slug) * dir
        : (a.postCount - b.postCount) * dir,
    );
  });

  const totalPages = $derived(Math.max(1, Math.ceil(sortedEntries.length / pageSize)));
  const safePage = $derived(Math.min(currentPage, totalPages));
  const pageEntries = $derived(
    sortedEntries.slice((safePage - 1) * pageSize, safePage * pageSize),
  );

  // ---------------------------------------------------------------------------
  // Image preload cache — keep a sliding window of ±4 pages in memory
  // ---------------------------------------------------------------------------
  const _preloadCache = new Map<string, HTMLImageElement>();

  const _preloadUrls = $derived.by(() => {
    if (!store.manifest) return [] as string[];
    const { imageBaseUrl, releasePrefix } = store.manifest;
    const start = Math.max(1, safePage - 4);
    const end = Math.min(totalPages, safePage + 1);
    const urls: string[] = [];
    for (let p = start; p <= end; p++) {
      for (const hit of sortedEntries.slice((p - 1) * pageSize, p * pageSize)) {
        if (hit.hasImage && hit.imageId) {
          urls.push(`${imageBaseUrl}/${releasePrefix}/images/${hit.imageId}.webp`);
        }
      }
    }
    return urls;
  });

  $effect(() => {
    const urlSet = new Set(_preloadUrls);
    for (const url of urlSet) {
      if (!_preloadCache.has(url)) {
        const img = new Image();
        img.src = url;
        _preloadCache.set(url, img);
      }
    }
    for (const url of _preloadCache.keys()) {
      if (!urlSet.has(url)) _preloadCache.delete(url);
    }
  });
</script>

<div class="flex h-full w-full flex-col overflow-hidden bg-neutral-950 text-neutral-100">
  <header class="flex-none border-b border-neutral-800 bg-neutral-900/60 px-4 py-3">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 class="text-lg font-semibold">Artist Gallery</h1>
        <p class="text-xs text-neutral-500">
          {#if store.manifest}
            {store.manifest.artistsWithImage.toLocaleString()} artists ·
            Anima preview · release {store.manifest.releasePrefix}
          {:else if store.manifestError}
            <span class="text-red-400">failed to load: {store.manifestError}</span>
          {:else}
            loading manifest…
          {/if}
        </p>
      </div>

      <!-- Search with suggestions -->
      <div class="relative w-full max-w-sm">
        <input
          type="search"
          placeholder="Search artist tag…"
          value={queryInput}
          oninput={(e) => onSearchInput(e.currentTarget.value)}
          onfocus={onInputFocus}
          onblur={onInputBlur}
          class="w-full rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-neutral-100 placeholder-neutral-500 focus:border-indigo-500 focus:outline-none"
        />
        {#if store.searchLoading}
          <span class="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-neutral-500">…</span>
        {/if}

        {#if showSuggestions && queryInput.trim() && store.results.length > 0}
          <ul class="absolute left-0 right-0 top-full z-50 mt-1 max-h-72 overflow-y-auto rounded-lg border border-neutral-700 bg-neutral-900 shadow-lg">
            {#each store.results as hit (hit.slug)}
              <li>
                <button
                  type="button"
                  onmousedown={(e) => e.preventDefault()}
                  onclick={() => openHit(hit.slug, -1)}
                  class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-neutral-800"
                >
                  {#if thumbUrl(hit)}
                    <img
                      src={thumbUrl(hit)}
                      alt={hit.tag}
                      loading="lazy"
                      class="h-8 w-6 shrink-0 rounded object-cover"
                    />
                  {:else}
                    <div class="h-8 w-6 shrink-0 rounded bg-neutral-700"></div>
                  {/if}
                  <span class="flex-1 truncate text-neutral-100">{displayTag(hit.tag)}</span>
                  <span class="shrink-0 text-xs text-neutral-500">{formatCount(hit.postCount)}</span>
                </button>
              </li>
            {/each}
          </ul>
        {:else if showSuggestions && queryInput.trim() && !store.searchLoading && store.results.length === 0}
          <div class="absolute left-0 right-0 top-full z-50 mt-1 rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-500 shadow-lg">
            No matches for "{queryInput}"
          </div>
        {/if}
      </div>
    </div>

    <!-- Sort + page size toolbar -->
    {#if store.manifest}
      <div class="mt-3 flex flex-wrap items-center gap-2">
        <div class="flex items-center gap-0.5 rounded-lg border border-neutral-800 bg-neutral-900/50 p-1">
          <span class="px-1.5 text-xs text-neutral-500">Sort:</span>
          <button
            type="button"
            class="rounded px-2 py-0.5 text-xs transition-colors {sortField === 'postCount' ? 'bg-indigo-600 text-white' : 'text-neutral-400 hover:text-neutral-200'}"
            onclick={() => setSort('postCount')}
          >
            Post Count
          </button>
          <button
            type="button"
            class="rounded px-2 py-0.5 text-xs transition-colors {sortField === 'name' ? 'bg-indigo-600 text-white' : 'text-neutral-400 hover:text-neutral-200'}"
            onclick={() => setSort('name')}
          >
            Name
          </button>
          <button
            type="button"
            class="rounded px-2 py-0.5 text-xs transition-colors {sortField === 'uniqueness' ? 'bg-amber-600 text-white' : 'text-neutral-400 hover:text-neutral-200'}"
            onclick={() => setSort('uniqueness')}
            title="Surfaces hidden gems: artists with a distinctive style not yet overexposed"
          >
            Unique
          </button>
          <div class="mx-1 h-3 w-px shrink-0 bg-neutral-700"></div>
          {#if sortField === 'uniqueness'}
            <button
              type="button"
              class="rounded px-2 py-0.5 text-xs text-amber-400 transition-colors hover:text-amber-200"
              onclick={rotateUniqueness}
              title="Reshuffle the uniqueness ranking to discover a fresh set of hidden gems"
            >
              ↻ Rotate
            </button>
          {:else}
            <button
              type="button"
              class="rounded px-2 py-0.5 text-xs transition-colors {sortDir === 'desc' ? 'bg-indigo-600 text-white' : 'text-neutral-400 hover:text-neutral-200'}"
              onclick={() => setDir('desc')}
              title="Descending"
            >
              ↓ Desc
            </button>
            <button
              type="button"
              class="rounded px-2 py-0.5 text-xs transition-colors {sortDir === 'asc' ? 'bg-indigo-600 text-white' : 'text-neutral-400 hover:text-neutral-200'}"
              onclick={() => setDir('asc')}
              title="Ascending"
            >
              ↑ Asc
            </button>
          {/if}
        </div>

        <div class="flex items-center gap-0.5 rounded-lg border border-neutral-800 bg-neutral-900/50 p-1">
          <span class="px-1.5 text-xs text-neutral-500">Per page:</span>
          {#each PAGE_SIZES as size}
            <button
              type="button"
              class="rounded px-2 py-0.5 text-xs transition-colors {pageSize === size ? 'bg-indigo-600 text-white' : 'text-neutral-400 hover:text-neutral-200'}"
              onclick={() => setPageSize(size)}
            >
              {size}
            </button>
          {/each}
        </div>
      </div>
    {/if}
  </header>

  <div class="flex-1 overflow-y-auto" bind:this={scrollContainer}>
    {#if allError}
      <div class="p-8 text-center text-sm text-red-400">
        Failed to load artists: {allError}
      </div>
    {:else if allLoading}
      <div class="p-8 text-center text-sm text-neutral-500">loading artists…</div>
    {:else}
      {#if totalPages > 1}
        <div class="flex items-center justify-center gap-3 border-b border-neutral-800/60 px-4 py-2">
          <button
            type="button"
            class="rounded-md border border-neutral-700 bg-neutral-800 px-3 py-1 text-sm text-neutral-300 transition-colors hover:border-indigo-500 disabled:cursor-not-allowed disabled:opacity-40"
            disabled={safePage <= 1}
            onclick={() => goToPage(safePage - 1)}
          >
            ← Prev
          </button>
          <span class="text-sm text-neutral-400">
            Page {safePage} of {totalPages}
            <span class="text-neutral-600">·</span>
            {sortedEntries.length.toLocaleString()} artists
          </span>
          <button
            type="button"
            class="rounded-md border border-neutral-700 bg-neutral-800 px-3 py-1 text-sm text-neutral-300 transition-colors hover:border-indigo-500 disabled:cursor-not-allowed disabled:opacity-40"
            disabled={safePage >= totalPages}
            onclick={() => goToPage(safePage + 1)}
          >
            Next →
          </button>
        </div>
      {/if}
      <div class="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-3 p-4">
        {#each pageEntries as hit, i (hit.slug)}
          {@const url = thumbUrl(hit)}
          {@const rank = (safePage - 1) * pageSize + i + 1}
          <button
            type="button"
            class="group flex flex-col items-stretch overflow-hidden rounded-lg border bg-neutral-900 text-left transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 {copiedSlug === hit.slug ? 'border-emerald-500' : 'border-neutral-800 hover:border-indigo-500'}"
            onclick={() => openHit(hit.slug, i)}
            oncontextmenu={(e) => { e.preventDefault(); void copyTag(hit.tag, hit.slug); }}
            title="{hit.tag} · Right-click to copy tag"
          >
            <div class="relative aspect-3/4 w-full bg-neutral-800">
              {#if url}
                <img
                  src={url}
                  alt={hit.tag}
                  loading="eager"
                  decoding="auto"
                  class="h-full w-full object-cover"
                />
              {:else}
                <div class="flex h-full w-full items-center justify-center text-xs text-neutral-500">
                  no preview
                </div>
              {/if}
              {#if sortField === 'uniqueness'}
                <div class="absolute left-1 top-1 rounded bg-amber-600/90 px-1 py-0.5 text-[10px] font-mono font-bold leading-none text-white">
                  #{rank}
                </div>
              {/if}
              {#if copiedSlug === hit.slug}
                <div class="absolute inset-0 flex items-center justify-center bg-neutral-900/80">
                  <span class="rounded bg-emerald-600 px-2 py-1 text-xs font-semibold text-white">Copied!</span>
                </div>
              {/if}
            </div>
            <div class="flex items-center justify-between gap-2 px-2 py-1.5">
              <span class="truncate text-sm text-red-400">{displayTag(hit.tag)}</span>
              <span class="shrink-0 text-xs text-neutral-500">{formatCount(hit.postCount)}</span>
            </div>
          </button>
        {/each}
      </div>

      <!-- Pagination -->
      {#if totalPages > 1}
        <div class="flex items-center justify-center gap-3 px-4 py-4">
          <button
            type="button"
            class="rounded-md border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-sm text-neutral-300 transition-colors hover:border-indigo-500 disabled:cursor-not-allowed disabled:opacity-40"
            disabled={safePage <= 1}
            onclick={() => goToPage(safePage - 1)}
          >
            ← Prev
          </button>
          <span class="text-sm text-neutral-400">
            Page {safePage} of {totalPages}
            <span class="text-neutral-600">·</span>
            {sortedEntries.length.toLocaleString()} artists
          </span>
          <button
            type="button"
            class="rounded-md border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-sm text-neutral-300 transition-colors hover:border-indigo-500 disabled:cursor-not-allowed disabled:opacity-40"
            disabled={safePage >= totalPages}
            onclick={() => goToPage(safePage + 1)}
          >
            Next →
          </button>
        </div>
      {/if}
    {/if}
  </div>
</div>

{#if active}
  <ArtistLightbox
    entry={active}
    onclose={closeLightbox}
    {oninsertTag}
    onprev={activeIndex > 0 ? () => navigateTo(activeIndex - 1) : undefined}
    onnext={activeIndex >= 0 && activeIndex < pageEntries.length - 1 ? () => navigateTo(activeIndex + 1) : undefined}
  />
{/if}
