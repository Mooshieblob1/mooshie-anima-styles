<script lang="ts">
  import ArtistGalleryPage from "./lib/artist-gallery/components/ArtistGalleryPage.svelte";

  const MANIFEST_URL =
    "https://cdn.mooshieblob.com/20260325_anima_all_artists/indices/manifest.json";
</script>

<div class="h-screen w-screen overflow-hidden bg-neutral-950">
  <ArtistGalleryPage manifestUrl={MANIFEST_URL} />
</div>
