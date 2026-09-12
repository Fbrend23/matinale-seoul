// Le cours du won contre le franc, relevé auprès de Frankfurter.
//
// Même statut que la météo, et même construction : un accessoire du brief,
// qui ne retient jamais l'actualité. Le module lève, l'ingestion décide d'en
// faire un silence. `fetcher` injectable et minuteur d'abandon, pour être
// testé sans réseau.
//
// Frankfurter sert les taux de référence de la Banque centrale européenne,
// gratuitement et sans clé : aucun secret nouveau. La BCE publie un taux par
// jour OUVRÉ, vers 16 h à Francfort ; le samedi, le dimanche et les jours
// fériés, « latest » rend celui du dernier jour ouvré. C'est pourquoi le relevé
// porte deux dates — celle du brief, et celle du cours — et pourquoi le widget
// affiche la seconde.

const BASE = 'https://api.frankfurter.dev/v1/latest';

export const DEVISES = { base: 'CHF', quote: 'KRW' };

// Au-delà, un cours n'est plus « le dernier connu », c'est un cours périmé
// qu'on afficherait sous une date récente. Dix jours passent Noël et le Nouvel
// An, où la BCE se tait presque une semaine.
const ÂGE_MAX_JOURS = 10;

/** L'adresse du relevé. Exportée pour être testée sans réseau. */
export function urlCours() {
  const params = new URLSearchParams({ base: DEVISES.base, symbols: DEVISES.quote });
  return `${BASE}?${params}`;
}

const nombre = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);

function joursEntre(a, b) {
  return Math.round((new Date(`${b}T00:00:00Z`) - new Date(`${a}T00:00:00Z`)) / 86_400_000);
}

/** Le cours du jour, ou une exception qui dit pourquoi non. */
export async function relevéChange({ date }, { fetcher = fetch, timeoutMs = 5_000 } = {}) {
  const controller = new AbortController();
  const minuteur = setTimeout(() => controller.abort(), timeoutMs);

  let res;
  try {
    res = await fetcher(urlCours(), { signal: controller.signal });
  } catch (e) {
    throw new Error(
      e.name === 'AbortError' ? `pas de réponse en ${timeoutMs / 1000} s` : e.message
    );
  } finally {
    clearTimeout(minuteur);
  }

  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const json = await res.json().catch(() => null);
  const taux = nombre(json?.rates?.[DEVISES.quote]);
  const dateCours = json?.date;

  if (taux === null || typeof dateCours !== 'string') {
    throw new Error('relevé incomplet : ni taux ni date exploitables');
  }

  // Un cours du futur est une horloge fausse quelque part ; un cours trop
  // vieux est un cours périmé. Ni l'un ni l'autre ne mérite d'être affiché.
  const âge = joursEntre(dateCours, date);
  if (âge < 0) throw new Error(`cours daté du ${dateCours}, après le brief du ${date}`);
  if (âge > ÂGE_MAX_JOURS) throw new Error(`cours daté du ${dateCours}, trop ancien pour le ${date}`);

  return {
    date,
    rate_date: dateCours,
    base: DEVISES.base,
    quote: DEVISES.quote,
    rate: taux,
    fetched_at: new Date().toISOString(),
    source: 'frankfurter',
  };
}
