// Leaf identification through the Pl@ntNet API (free plan: 500 identifications a day,
// commercial use allowed). Without PLANTNET_API_KEY the app still works: the person types the tree.
const ENDPOINT = 'https://my-api.plantnet.org/v2/identify/all';

export async function identifyLeaf(photo) {
  const key = process.env.PLANTNET_API_KEY;
  if (!key) return { available: false, suggestions: [] };

  const form = new FormData();
  form.append('images', photo, 'leaf.jpg');
  form.append('organs', 'leaf');
  const url = `${ENDPOINT}?api-key=${encodeURIComponent(key)}&lang=${process.env.PLANTNET_LANG || 'en'}&nb-results=5`;

  try {
    const res = await fetch(url, { method: 'POST', body: form, signal: AbortSignal.timeout(15_000) });
    if (res.status === 404) return { available: true, suggestions: [] }; // Pl@ntNet: "species not found"
    if (res.status === 429) return { available: false, suggestions: [], reason: 'daily limit reached' };
    if (!res.ok) return { available: false, suggestions: [], reason: `identification service error ${res.status}` };
    const data = await res.json();
    const suggestions = (data.results || []).slice(0, 5).map((r) => {
      const sp = r.species || {};
      const common = (sp.commonNames || [])[0];
      return {
        name: common ? capitalise(common) : sp.scientificNameWithoutAuthor,
        scientific: sp.scientificNameWithoutAuthor || null,
        score: Math.round((r.score || 0) * 100) / 100,
      };
    });
    return { available: true, suggestions };
  } catch (err) {
    console.error('identify failed', err.message);
    return { available: false, suggestions: [], reason: 'identification service unreachable' };
  }
}

const capitalise = (s) => s.charAt(0).toUpperCase() + s.slice(1);
